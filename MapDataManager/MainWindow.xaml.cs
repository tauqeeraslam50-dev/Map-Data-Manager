using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Imaging;
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

    public MainWindow()
    {
        InitializeComponent();
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("MapDataManager/1.0");

        var map = new Map();
        map.Layers.Add(OpenStreetMap.CreateTileLayer());
        MapControl.Map = map;
        MapControl.Map.Navigator.CenterOnAndZoomTo(WebMercator(73.0479, 33.6844), 5000);
        StatusText.Text = "Online OpenStreetMap base map loaded. Search a place or coordinates.";
        ModeStatus.Content = "ONLINE";
    }

    private async void SelectFolder_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Select the folder containing offline XYZ/TMS map tiles",
            Multiselect = false
        };

        if (dialog.ShowDialog() != true)
            return;

        _offlineFolder = dialog.FolderName;
        await LoadOfflineTilesAsync(_offlineFolder);
    }

    private async Task LoadOfflineTilesAsync(string folder)
    {
        try
        {
            StatusText.Text = "Scanning offline map tiles...";
            _offlineTiles.Clear();
            OfflineCanvas.Children.Clear();

            foreach (var path in Directory.EnumerateFiles(folder, "*.*", SearchOption.AllDirectories))
            {
                if (!IsRasterTile(path)) continue;
                if (!TryParseTilePath(path, folder, out var tile)) continue;
                _offlineTiles.Add(tile);
            }

            if (_offlineTiles.Count == 0)
            {
                CoverageText.Text = "No XYZ/TMS raster tiles detected.";
                StatusText.Text = "No supported tile structure was found.";
                return;
            }

            _offlineZoom = _offlineTiles.Max(t => t.Z);
            var selected = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
            var minX = selected.Min(t => t.X);
            var maxX = selected.Max(t => t.X);
            var minY = selected.Min(t => t.Y);
            var maxY = selected.Max(t => t.Y);

            const double tileSize = 256;
            OfflineCanvas.Width = (maxX - minX + 1) * tileSize;
            OfflineCanvas.Height = (maxY - minY + 1) * tileSize;

            foreach (var tile in selected)
            {
                var image = new Image
                {
                    Width = tileSize,
                    Height = tileSize,
                    Stretch = System.Windows.Media.Stretch.Fill,
                    Source = LoadBitmap(tile.Path)
                };

                if (image.Source == null) continue;
                Canvas.SetLeft(image, (tile.X - minX) * tileSize);
                Canvas.SetTop(image, (tile.Y - minY) * tileSize);
                OfflineCanvas.Children.Add(image);
            }

            OfflineScrollViewer.Visibility = Visibility.Visible;
            MapControl.Visibility = Visibility.Collapsed;
            ModeStatus.Content = "OFFLINE";
            var tileScheme = _offlineTms ? "TMS" : "XYZ";
            CoverageText.Text = $"{_offlineTiles.Count:N0} raster tiles • Zoom {_offlineZoom} • {tileScheme}";
            FileStatus.Content = folder;
            StatusText.Text = $"Offline map rendered from {_offlineTiles.Count:N0} detected tiles at zoom {_offlineZoom}.";

            await Task.Yield();
            OfflineScrollViewer.ScrollToHorizontalOffset(Math.Max(0, OfflineCanvas.Width / 2 - OfflineScrollViewer.ViewportWidth / 2));
            OfflineScrollViewer.ScrollToVerticalOffset(Math.Max(0, OfflineCanvas.Height / 2 - OfflineScrollViewer.ViewportHeight / 2));
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Offline map error: {ex.Message}";
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
            }
            return;
        }

        if (ModeStatus.Content?.ToString() == "OFFLINE")
        {
            StatusText.Text = "Offline search accepts coordinates because no internet geocoder is used in offline mode.";
            return;
        }

        try
        {
            StatusText.Text = "Searching...";
            var url = $"https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q={Uri.EscapeDataString(query)}";
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
        var latRad = lat * Math.PI / 180.0;
        var y = (1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n;
        if (_offlineTms) y = n - 1 - y;

        var tiles = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
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
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.UriSource = new Uri(path, UriKind.Absolute);
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
        if (!int.TryParse(parts[^3], out var z)) return false;
        if (!int.TryParse(parts[^2], out var second)) return false;
        if (!int.TryParse(fileName, out var third)) return false;
        if (z < 0 || z > 24) return false;

        var tms = root.Contains("tms", StringComparison.OrdinalIgnoreCase);
        _ = tms;
        tile = new OfflineTile(path, z, second, third);
        return true;
    }

    private static bool IsRasterTile(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".webp", StringComparison.OrdinalIgnoreCase);
    }

    private void OfflineMap_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Offline Map";
        ModeStatus.Content = "OFFLINE";
        MapControl.Visibility = Visibility.Collapsed;
        OfflineScrollViewer.Visibility = Visibility.Visible;
        StatusText.Text = _offlineTiles.Count > 0 ? "Offline dataset loaded. Search coordinates to locate an area." : "Select an offline XYZ/TMS folder.";
    }

    private void OnlineMap_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Online Map";
        ModeStatus.Content = "ONLINE";
        MapControl.Visibility = Visibility.Visible;
        OfflineScrollViewer.Visibility = Visibility.Collapsed;
        StatusText.Text = "Online OpenStreetMap base layer is active. Search a place or coordinates.";
    }

    private void MapData_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Map Data";
        StatusText.Text = _offlineTiles.Count > 0 ? $"Loaded {_offlineTiles.Count:N0} raster tiles." : "No offline map data loaded.";
    }

    private readonly record struct OfflineTile(string Path, int Z, int X, int Y);
    private sealed record NominatimResult(string Lat, string Lon, string DisplayName);
}
