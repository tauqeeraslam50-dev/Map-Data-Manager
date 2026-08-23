using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Forms = System.Windows.Forms;
using Mapsui;
using Mapsui.Tiling;

namespace MapDataManager;

public partial class MainWindow : Window
{
    private readonly HttpClient _httpClient = new();
    private readonly List<OfflineTile> _offlineTiles = new();
    private int _offlineZoom = -1;
    private bool _offlineTms;
    private string? _offlineFolder;

    // Small built-in English gazetteer for offline search and labels.
    // It works without Internet and is intentionally focused on major Pakistan locations.
    private static readonly Place[] PakistanPlaces =
    {
        new("Islamabad", 33.6844, 73.0479), new("Rawalpindi", 33.5651, 73.0169),
        new("Lahore", 31.5204, 74.3587), new("Karachi", 24.8607, 67.0011),
        new("Peshawar", 34.0151, 71.5249), new("Quetta", 30.1798, 66.9750),
        new("Multan", 30.1575, 71.5249), new("Faisalabad", 31.4504, 73.1350),
        new("Gujranwala", 32.1877, 74.1945), new("Sialkot", 32.4945, 74.5229),
        new("Sargodha", 32.0836, 72.6711), new("Bahawalpur", 29.3956, 71.6836),
        new("Sukkur", 27.7244, 68.8228), new("Hyderabad", 25.3960, 68.3578),
        new("Abbottabad", 34.1688, 73.2215), new("Mardan", 34.1989, 72.0409),
        new("Mingora", 34.7717, 72.3602), new("Muzaffarabad", 34.3700, 73.4711),
        new("Gilgit", 35.9208, 74.3144), new("Skardu", 35.2971, 75.6333),
        new("Chitral", 35.8518, 71.7864), new("Gwadar", 25.1264, 62.3225),
        new("Turbat", 26.0023, 63.0600), new("Dera Ismail Khan", 31.8327, 70.9024),
        new("Dera Ghazi Khan", 30.0561, 70.6348), new("Jhelum", 32.9425, 73.7257),
        new("Gujrat", 32.5742, 74.0754), new("Kasur", 31.1158, 74.4467),
        new("Sheikhupura", 31.7131, 73.9783), new("Rahim Yar Khan", 28.4202, 70.2952),
        new("Larkana", 27.5580, 68.2120), new("Nawabshah", 26.2442, 68.4100),
        new("Kohat", 33.5889, 71.4429), new("Bannu", 32.9861, 70.6042),
        new("Wah Cantt", 33.7715, 72.7511), new("Taxila", 33.7467, 72.8397),
        new("Murree", 33.9070, 73.3943), new("Kaghan", 34.7794, 73.5631),
        new("Naran", 34.9085, 73.6500)
    };

    public MainWindow()
    {
        InitializeComponent();
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("MapDataManager/1.0 (offline map manager)");

        var map = new Map();
        map.Layers.Add(OpenStreetMap.CreateTileLayer());
        MapControl.Map = map;
        MapControl.Map.Navigator.CenterOnAndZoomTo(WebMercator(73.0479, 33.6844), 5000);
        StatusText.Text = "Online OpenStreetMap base map loaded. Search an English place name or coordinates.";
        ModeStatus.Content = "ONLINE";
    }

    private async void SelectFolder_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new Forms.FolderBrowserDialog
        {
            Description = "Select the folder containing offline XYZ/TMS map tiles",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        if (dialog.ShowDialog() != Forms.DialogResult.OK || string.IsNullOrWhiteSpace(dialog.SelectedPath))
            return;

        _offlineFolder = dialog.SelectedPath;
        await LoadOfflineTilesAsync(_offlineFolder);
    }

    private async void Download_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new DownloadWindow { Owner = this };
        if (dialog.ShowDialog() != true) return;

        using var folderDialog = new Forms.FolderBrowserDialog
        {
            Description = "Choose the folder where the offline XYZ map will be stored",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true
        };

        if (folderDialog.ShowDialog() != Forms.DialogResult.OK || string.IsNullOrWhiteSpace(folderDialog.SelectedPath))
            return;

        try
        {
            var output = Path.Combine(folderDialog.SelectedPath, "OfflineMaps", dialog.DatasetName);
            Directory.CreateDirectory(output);
            await DownloadTilesAsync(dialog, output);
            _offlineFolder = output;
            await LoadOfflineTilesAsync(output);
            OfflineMap_Click(this, new RoutedEventArgs());
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Download failed: {ex.Message}";
        }
    }

    private async Task DownloadTilesAsync(DownloadWindow settings, string output)
    {
        var total = 0L;
        for (var z = settings.MinZoom; z <= settings.MaxZoom; z++)
        {
            var (minX, maxX, minY, maxY) = TileRange(settings.West, settings.South, settings.East, settings.North, z);
            total += (long)(maxX - minX + 1) * (maxY - minY + 1);
        }

        if (total > 5000)
        {
            var answer = MessageBox.Show(
                $"This download contains about {total:N0} tiles and may be large. Continue?",
                "Large offline map download", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (answer != MessageBoxResult.Yes) return;
        }

        long done = 0;
        StatusText.Text = $"Downloading {total:N0} map tiles...";

        for (var z = settings.MinZoom; z <= settings.MaxZoom; z++)
        {
            var (minX, maxX, minY, maxY) = TileRange(settings.West, settings.South, settings.East, settings.North, z);
            for (var x = minX; x <= maxX; x++)
            {
                for (var y = minY; y <= maxY; y++)
                {
                    var file = Path.Combine(output, z.ToString(CultureInfo.InvariantCulture), x.ToString(CultureInfo.InvariantCulture), $"{y}.png");
                    if (!File.Exists(file))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                        var url = $"https://tile.openstreetmap.org/{z}/{x}/{y}.png";
                        try
                        {
                            var bytes = await _httpClient.GetByteArrayAsync(url);
                            await File.WriteAllBytesAsync(file, bytes);
                        }
                        catch
                        {
                            // Keep going so one unavailable tile does not abort the complete dataset.
                        }
                        await Task.Delay(80);
                    }

                    done++;
                    if (done % 10 == 0 || done == total)
                        StatusText.Text = $"Downloading offline map: {done:N0}/{total:N0} tiles ({done * 100.0 / Math.Max(1, total):F0}%)";
                }
            }
        }

        StatusText.Text = $"Offline download complete: {done:N0} tiles.";
    }

    private static (int MinX, int MaxX, int MinY, int MaxY) TileRange(double west, double south, double east, double north, int z)
    {
        var n = 1 << z;
        var minX = (int)Math.Floor((west + 180.0) / 360.0 * n);
        var maxX = (int)Math.Floor((east + 180.0) / 360.0 * n);
        var minY = LatToTileY(north, z);
        var maxY = LatToTileY(south, z);
        minX = Math.Clamp(minX, 0, n - 1);
        maxX = Math.Clamp(maxX, 0, n - 1);
        minY = Math.Clamp(minY, 0, n - 1);
        maxY = Math.Clamp(maxY, 0, n - 1);
        return (Math.Min(minX, maxX), Math.Max(minX, maxX), Math.Min(minY, maxY), Math.Max(minY, maxY));
    }

    private static int LatToTileY(double lat, int z)
    {
        var n = Math.Pow(2, z);
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180.0;
        return (int)Math.Floor((1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n);
    }

    private async Task LoadOfflineTilesAsync(string folder)
    {
        try
        {
            StatusText.Text = "Scanning offline map tiles...";
            CoverageText.Text = "Scanning...";
            _offlineTiles.Clear();
            OfflineCanvas.Children.Clear();
            _offlineTms = IsTmsFolder(folder);

            foreach (var path in Directory.EnumerateFiles(folder, "*.*", SearchOption.AllDirectories))
            {
                if (!IsRasterTile(path)) continue;
                if (!TryParseTilePath(path, folder, out var tile)) continue;
                _offlineTiles.Add(tile);
            }

            if (_offlineTiles.Count == 0)
            {
                OfflineScrollViewer.Visibility = Visibility.Visible;
                MapControl.Visibility = Visibility.Collapsed;
                CoverageText.Text = "No XYZ/TMS PNG/JPEG tiles detected.";
                StatusText.Text = "Select a folder with tiles arranged as Z\\X\\Y.png (XYZ).";
                return;
            }

            _offlineZoom = _offlineTiles.Max(t => t.Z);
            var selected = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
            var minX = selected.Min(t => t.X);
            var maxX = selected.Max(t => t.X);
            var minY = selected.Min(t => t.Y);
            var maxY = selected.Max(t => t.Y);

            const double tileSize = 256;
            OfflineCanvas.Width = Math.Max(tileSize, (maxX - minX + 1) * tileSize);
            OfflineCanvas.Height = Math.Max(tileSize, (maxY - minY + 1) * tileSize);

            var rendered = 0;
            foreach (var tile in selected)
            {
                var source = LoadBitmap(tile.Path);
                if (source == null) continue;

                var image = new Image
                {
                    Width = tileSize,
                    Height = tileSize,
                    Stretch = Stretch.Fill,
                    Source = source,
                    SnapsToDevicePixels = true
                };

                Canvas.SetLeft(image, (tile.X - minX) * tileSize);
                Canvas.SetTop(image, (tile.Y - minY) * tileSize);
                OfflineCanvas.Children.Add(image);
                rendered++;
            }

            AddOfflineEnglishLabels(_offlineZoom, minX, minY, maxX, maxY, tileSize);

            OfflineScrollViewer.Visibility = Visibility.Visible;
            MapControl.Visibility = Visibility.Collapsed;
            ModeStatus.Content = "OFFLINE";
            var scheme = _offlineTms ? "TMS" : "XYZ";
            CoverageText.Text = $"{_offlineTiles.Count:N0} tiles • Zoom {_offlineZoom} • {scheme} • {rendered:N0} rendered • English labels";
            FileStatus.Content = folder;
            StatusText.Text = rendered == 0
                ? "Tiles were detected but none could be decoded. Use PNG or JPEG tiles."
                : $"Offline map loaded successfully from zoom {_offlineZoom}.";

            await Task.Yield();
            OfflineScrollViewer.ScrollToHorizontalOffset(Math.Max(0, OfflineCanvas.Width / 2 - OfflineScrollViewer.ViewportWidth / 2));
            OfflineScrollViewer.ScrollToVerticalOffset(Math.Max(0, OfflineCanvas.Height / 2 - OfflineScrollViewer.ViewportHeight / 2));
        }
        catch (Exception ex)
        {
            CoverageText.Text = "Offline map load failed.";
            StatusText.Text = $"Offline map error: {ex.Message}";
        }
    }

    private void AddOfflineEnglishLabels(int zoom, int minX, int minY, int maxX, int maxY, double tileSize)
    {
        var n = Math.Pow(2, zoom);
        foreach (var place in PakistanPlaces)
        {
            var x = (place.Longitude + 180.0) / 360.0 * n;
            var latRad = Math.Clamp(place.Latitude, -85.05112878, 85.05112878) * Math.PI / 180.0;
            var y = (1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n;
            if (_offlineTms) y = n - 1 - y;

            var px = (x - minX) * tileSize;
            var py = (y - minY) * tileSize;
            if (px < -100 || py < -40 || px > OfflineCanvas.Width + 100 || py > OfflineCanvas.Height + 40) continue;

            var label = new TextBlock
            {
                Text = place.Name,
                Foreground = Brushes.White,
                Background = new System.Windows.Media.SolidColorBrush(Color.FromArgb(190, 15, 23, 42)),
                FontSize = zoom >= 9 ? 13 : 11,
                FontWeight = FontWeights.SemiBold,
                Padding = new Thickness(3, 1, 3, 1)
            };
            Canvas.SetLeft(label, px + 6);
            Canvas.SetTop(label, py - 10);
            Panel.SetZIndex(label, 10);
            OfflineCanvas.Children.Add(label);
        }
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            await SearchAsync();
    }

    private async Task SearchAsync()
    {
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query)) return;

        if (TryParseCoordinates(query, out var lat, out var lon))
        {
            if (ModeStatus.Content?.ToString() == "OFFLINE" && _offlineTiles.Count > 0)
            {
                CenterOfflineOnCoordinates(lat, lon);
                StatusText.Text = $"Offline search: {lat:F6}, {lon:F6}";
            }
            else
            {
                ShowOnlineCoordinates(lat, lon);
                StatusText.Text = $"Online coordinates: {lat:F6}, {lon:F6}";
            }
            return;
        }

        if (ModeStatus.Content?.ToString() == "OFFLINE")
        {
            var place = PakistanPlaces.FirstOrDefault(p =>
                p.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                query.Contains(p.Name, StringComparison.OrdinalIgnoreCase));

            if (place == null)
            {
                StatusText.Text = "Offline place not found. Use an installed English place or coordinates.";
                return;
            }

            CenterOfflineOnCoordinates(place.Latitude, place.Longitude);
            StatusText.Text = $"Offline search: {place.Name} ({place.Latitude:F4}, {place.Longitude:F4})";
            return;
        }

        try
        {
            StatusText.Text = "Searching online...";
            var url = $"https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q={Uri.EscapeDataString(query)}";
            using var response = await _httpClient.GetAsync(url);
            response.EnsureSuccessStatusCode();
            using var stream = await response.Content.ReadAsStreamAsync();
            var results = await JsonSerializer.DeserializeAsync<List<NominatimResult>>(stream);

            if (results == null || results.Count == 0)
            {
                StatusText.Text = "Place not found.";
                return;
            }

            lat = double.Parse(results[0].Lat, CultureInfo.InvariantCulture);
            lon = double.Parse(results[0].Lon, CultureInfo.InvariantCulture);
            ShowOnlineCoordinates(lat, lon);
            StatusText.Text = $"Found: {results[0].DisplayName}";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Search failed: {ex.Message}";
        }
    }

    private void ZoomIn_Click(object sender, RoutedEventArgs e)
    {
        if (ModeStatus.Content?.ToString() == "ONLINE")
            MapControl.Map.Navigator.ZoomIn();
        else
            ZoomOffline(1.35);
    }

    private void ZoomOut_Click(object sender, RoutedEventArgs e)
    {
        if (ModeStatus.Content?.ToString() == "ONLINE")
            MapControl.Map.Navigator.ZoomOut();
        else
            ZoomOffline(1.0 / 1.35);
    }

    private void ZoomHome_Click(object sender, RoutedEventArgs e)
    {
        if (ModeStatus.Content?.ToString() == "ONLINE")
            MapControl.Map.Navigator.CenterOnAndZoomTo(WebMercator(73.0479, 33.6844), 5000);
        else if (_offlineTiles.Count > 0)
        {
            OfflineScrollViewer.ScrollToHorizontalOffset(Math.Max(0, OfflineCanvas.Width / 2 - OfflineScrollViewer.ViewportWidth / 2));
            OfflineScrollViewer.ScrollToVerticalOffset(Math.Max(0, OfflineCanvas.Height / 2 - OfflineScrollViewer.ViewportHeight / 2));
        }
    }

    private void ZoomOffline(double scale)
    {
        if (_offlineTiles.Count == 0) return;
        var oldWidth = OfflineCanvas.Width;
        var oldHeight = OfflineCanvas.Height;
        OfflineCanvas.LayoutTransform = new ScaleTransform(scale, scale);
        OfflineCanvas.Width = Math.Max(256, oldWidth * scale);
        OfflineCanvas.Height = Math.Max(256, oldHeight * scale);
        StatusText.Text = scale > 1 ? "Offline map zoomed in." : "Offline map zoomed out.";
    }

    private void ShowOnlineCoordinates(double lat, double lon)
    {
        MapControl.Visibility = Visibility.Visible;
        OfflineScrollViewer.Visibility = Visibility.Collapsed;
        ModeStatus.Content = "ONLINE";
        MapControl.Map.Navigator.CenterOnAndZoomTo(WebMercator(lon, lat), 1200);
    }

    private void CenterOfflineOnCoordinates(double lat, double lon)
    {
        if (_offlineTiles.Count == 0 || _offlineZoom < 0) return;

        var n = Math.Pow(2, _offlineZoom);
        var x = (lon + 180.0) / 360.0 * n;
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180.0;
        var y = (1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n;
        if (_offlineTms) y = n - 1 - y;

        var tiles = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
        if (tiles.Count == 0) return;
        var minX = tiles.Min(t => t.X);
        var minY = tiles.Min(t => t.Y);
        OfflineScrollViewer.ScrollToHorizontalOffset(Math.Max(0, (x - minX) * 256 - OfflineScrollViewer.ViewportWidth / 2));
        OfflineScrollViewer.ScrollToVerticalOffset(Math.Max(0, (y - minY) * 256 - OfflineScrollViewer.ViewportHeight / 2));
    }

    private static MPoint WebMercator(double lon, double lat)
    {
        const double radius = 6378137.0;
        var x = radius * lon * Math.PI / 180.0;
        var clampedLat = Math.Clamp(lat, -85.05112878, 85.05112878);
        var y = radius * Math.Log(Math.Tan(Math.PI / 4 + clampedLat * Math.PI / 360.0));
        return new MPoint(x, y);
    }

    private static BitmapImage? LoadBitmap(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private static bool TryParseCoordinates(string value, out double lat, out double lon)
    {
        lat = lon = 0;
        var parts = value.Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2) return false;
        if (!double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out lat)) return false;
        if (!double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out lon)) return false;
        return lat is >= -90 and <= 90 && lon is >= -180 and <= 180;
    }

    private static bool TryParseTilePath(string path, string root, out OfflineTile tile)
    {
        tile = default;
        var relative = Path.GetRelativePath(root, path).Replace('\\', '/');
        var parts = relative.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3) return false;

        var fileName = Path.GetFileNameWithoutExtension(parts[^1]);
        if (!int.TryParse(parts[^3], NumberStyles.Integer, CultureInfo.InvariantCulture, out var z)) return false;
        if (!int.TryParse(parts[^2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var x)) return false;
        if (!int.TryParse(fileName, NumberStyles.Integer, CultureInfo.InvariantCulture, out var y)) return false;
        if (z < 0 || z > 24) return false;

        var max = (1L << z) - 1;
        if (x < 0 || y < 0 || x > max || y > max) return false;

        tile = new OfflineTile(path, z, x, y);
        return true;
    }

    private static bool IsRasterTile(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTmsFolder(string folder)
    {
        var name = new DirectoryInfo(folder).Name;
        return name.Contains("tms", StringComparison.OrdinalIgnoreCase);
    }

    private void OfflineMap_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Offline Map";
        ModeStatus.Content = "OFFLINE";
        MapControl.Visibility = Visibility.Collapsed;
        OfflineScrollViewer.Visibility = Visibility.Visible;
        StatusText.Text = _offlineTiles.Count > 0 ? "Offline dataset loaded. Search English cities/places or coordinates." : "Select an offline XYZ/TMS folder.";
    }

    private void OnlineMap_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Online Map";
        ModeStatus.Content = "ONLINE";
        MapControl.Visibility = Visibility.Visible;
        OfflineScrollViewer.Visibility = Visibility.Collapsed;
        StatusText.Text = "Online OpenStreetMap base layer is active. Search English place names or coordinates.";
    }

    private void MapData_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Map Data";
        StatusText.Text = _offlineTiles.Count > 0 ? $"Loaded {_offlineTiles.Count:N0} raster tiles." : "No offline map data loaded.";
    }

    private readonly record struct OfflineTile(string Path, int Z, int X, int Y);
    private sealed record NominatimResult(string Lat, string Lon, string DisplayName);
    private sealed record Place(string Name, double Latitude, double Longitude);
}
