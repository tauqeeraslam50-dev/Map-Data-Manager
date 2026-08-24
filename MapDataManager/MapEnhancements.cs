using System.IO.Compression;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using WpfButton = System.Windows.Controls.Button;
using WpfCanvas = System.Windows.Controls.Canvas;
using WpfEllipse = System.Windows.Shapes.Ellipse;
using WpfPanel = System.Windows.Controls.Panel;
using WpfTextBlock = System.Windows.Controls.TextBlock;
using WpfBrushes = System.Windows.Media.Brushes;
using WpfSolidColorBrush = System.Windows.Media.SolidColorBrush;
using WpfMediaColor = System.Windows.Media.Color;
using Mapsui;
using Mapsui.Layers;
using Mapsui.Styles;
using Mapsui.Projections;
using ZstdNet;

namespace MapDataManager;

public partial class MainWindow
{
    private MemoryLayer? _searchLayer;
    private WpfButton? _pmTilesButton;

    static MainWindow()
    {
        EventManager.RegisterClassHandler(typeof(MainWindow), FrameworkElement.LoadedEvent, new RoutedEventHandler(OnEnhancedLoaded));
        EventManager.RegisterClassHandler(typeof(WpfButton), WpfButton.ClickEvent, new RoutedEventHandler(OnEnhancedButtonClick));
    }

    private static void OnEnhancedLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is not MainWindow window || window._pmTilesButton != null) return;
        if (window.FolderButton.Parent is not WpfPanel panel) return;
        var button = new WpfButton
        {
            Content = "PMTILES",
            Height = window.FolderButton.Height,
            Padding = new Thickness(12, 8, 12, 8),
            Margin = new Thickness(0, 0, 8, 0),
            ToolTip = "Open a local PMTiles raster archive"
        };
        panel.Children.Insert(Math.Max(0, panel.Children.IndexOf(window.FolderButton)), button);
        window._pmTilesButton = button;
    }

    private static async void OnEnhancedButtonClick(object sender, RoutedEventArgs e)
    {
        if (sender is not WpfButton button || button.Content?.ToString() != "SEARCH") return;
        var window = Window.GetWindow(button) as MainWindow;
        if (window is null) return;
        e.Handled = true;
        await window.EnhancedSearchAsync();
    }

    protected override void OnClosed(EventArgs e)
    {
        _searchLayer?.Dispose();
        base.OnClosed(e);
    }

    private async Task EnhancedSearchAsync()
    {
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query)) return;

        if (TryParseEnhancedCoordinates(query, out var lat, out var lon))
        {
            if (ModeStatus.Content?.ToString() == "OFFLINE" && _offlineTiles.Count > 0)
                CenterOfflineOnCoordinates(lat, lon);
            else
                ShowOnlineCoordinates(lat, lon);
            AddSearchMarker(lat, lon, $"{lat:F6}, {lon:F6}");
            UpdateCoordinateStatus(lat, lon, "Coordinate search");
            return;
        }

        if (ModeStatus.Content?.ToString() == "OFFLINE")
        {
            var place = PakistanPlaces.FirstOrDefault(p =>
                p.Name.Equals(query, StringComparison.OrdinalIgnoreCase) ||
                p.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                query.Contains(p.Name, StringComparison.OrdinalIgnoreCase));
            if (place is null)
            {
                StatusText.Text = "Offline place not found. Try a Pakistan city or coordinates.";
                return;
            }
            CenterOfflineOnCoordinates(place.Latitude, place.Longitude);
            AddSearchMarker(place.Latitude, place.Longitude, place.Name);
            UpdateCoordinateStatus(place.Latitude, place.Longitude, $"Offline: {place.Name}");
            return;
        }

        try
        {
            StatusText.Text = "Searching online...";
            using var request = new HttpRequestMessage(HttpMethod.Get,
                "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&addressdetails=1&q=" + Uri.EscapeDataString(query));
            request.Headers.UserAgent.ParseAdd("MapDataManager/1.1 (interactive map search)");
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(json);
            var result = document.RootElement.EnumerateArray().FirstOrDefault();
            if (result.ValueKind == JsonValueKind.Undefined)
            {
                StatusText.Text = "Online place not found.";
                return;
            }
            lat = result.GetProperty("lat").GetDouble();
            lon = result.GetProperty("lon").GetDouble();
            var display = result.TryGetProperty("display_name", out var d) ? d.GetString() ?? query : query;
            ShowOnlineCoordinates(lat, lon);
            AddSearchMarker(lat, lon, query);
            UpdateCoordinateStatus(lat, lon, display);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Online search failed: {ex.Message}";
        }
    }

    private void AddSearchMarker(double lat, double lon, string label)
    {
        if (MapControl.Map is null) return;
        _searchLayer?.Dispose();
        var projected = SphericalMercator.FromLonLat(lon, lat);
        var feature = new PointFeature(new MPoint(projected.x, projected.y));
        feature["Label"] = label;
        feature.Styles.Add(new SymbolStyle
        {
            SymbolType = SymbolType.Ellipse,
            SymbolScale = 1.35,
            Fill = new Brush(Color.Red),
            Outline = new Pen { Color = Color.White, Width = 2 }
        });
        feature.Styles.Add(new LabelStyle
        {
            Text = label,
            Offset = new Offset(12, -12),
            ForeColor = Color.White,
            BackColor = new Brush(Color.Black.WithAlpha(190))
        });
        _searchLayer = new MemoryLayer("Search Result") { Features = new[] { feature } };
        MapControl.Map.Layers.Add(_searchLayer);
        MapControl.Map.Refresh();

        if (ModeStatus.Content?.ToString() == "OFFLINE")
            AddOfflineSearchMarker(lat, lon, label);
    }

    private void AddOfflineSearchMarker(double lat, double lon, string label)
    {
        if (_offlineTiles.Count == 0 || _offlineZoom < 0) return;
        var selected = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
        if (selected.Count == 0) return;
        var minX = selected.Min(t => t.X);
        var minY = selected.Min(t => t.Y);
        var n = Math.Pow(2, _offlineZoom);
        var x = (lon + 180.0) / 360.0 * n;
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180.0;
        var y = (1 - Math.Log(Math.Tan(latRad) + 1 / Math.Cos(latRad)) / Math.PI) / 2 * n;
        if (_offlineTms) y = n - 1 - y;
        var px = (x - minX) * 256;
        var py = (y - minY) * 256;
        var marker = new WpfEllipse { Width = 18, Height = 18, Fill = WpfBrushes.Red, Stroke = WpfBrushes.White, StrokeThickness = 3, ToolTip = label };
        WpfCanvas.SetLeft(marker, px - 9); WpfCanvas.SetTop(marker, py - 9); WpfPanel.SetZIndex(marker, 100);
        OfflineCanvas.Children.Add(marker);
        var text = new WpfTextBlock
        {
            Text = label,
            Foreground = WpfBrushes.White,
            Background = new WpfSolidColorBrush(WpfMediaColor.FromArgb(220, 127, 29, 29)),
            Padding = new Thickness(4, 2, 4, 2),
            FontWeight = FontWeights.Bold
        };
        WpfCanvas.SetLeft(text, px + 10); WpfCanvas.SetTop(text, py - 14); WpfPanel.SetZIndex(text, 101);
        OfflineCanvas.Children.Add(text);
    }

    private void UpdateCoordinateStatus(double lat, double lon, string source)
    {
        var elevation = FindHgtElevation(_offlineFolder, lat, lon);
        StatusText.Text = elevation.HasValue
            ? $"{source} | Lat {lat:F6} | Lon {lon:F6} | Elevation {elevation.Value:F0} m"
            : $"{source} | Lat {lat:F6} | Lon {lon:F6} | Elevation: DEM not available";
    }

    private static bool TryParseEnhancedCoordinates(string value, out double lat, out double lon)
    {
        lat = lon = 0;
        var parts = value.Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2) return false;
        if (!double.TryParse(parts[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out lat)) return false;
        if (!double.TryParse(parts[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out lon)) return false;
        return lat is >= -90 and <= 90 && lon is >= -180 and <= 180;
    }

    private static double? FindHgtElevation(string? root, double lat, double lon)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return null;
        var south = (int)Math.Floor(lat);
        var west = (int)Math.Floor(lon);
        var ns = south >= 0 ? $"N{south:00}" : $"S{Math.Abs(south):00}";
        var ew = west >= 0 ? $"E{west:000}" : $"W{Math.Abs(west):000}";
        var wanted = ns + ew + ".hgt";
        var file = Directory.EnumerateFiles(root, "*.hgt", SearchOption.AllDirectories).FirstOrDefault(f => string.Equals(Path.GetFileName(f), wanted, StringComparison.OrdinalIgnoreCase));
        if (file is null) return null;
        try
        {
            var length = new FileInfo(file).Length;
            var samples = length switch { 3600L * 3600L * 2 => 3601, 1201L * 1201L * 2 => 1201, 1801L * 1801L * 2 => 1801, _ => 0 };
            if (samples == 0) return null;
            var col = Math.Clamp((int)Math.Round((lon - west) * (samples - 1)), 0, samples - 1);
            var row = Math.Clamp((int)Math.Round((south + 1 - lat) * (samples - 1)), 0, samples - 1);
            var offset = ((long)row * samples + col) * 2;
            using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            fs.Seek(offset, SeekOrigin.Begin);
            Span<byte> b = stackalloc byte[2]; fs.ReadExactly(b);
            var value = (short)((b[0] << 8) | b[1]);
            return value == -32768 ? null : value;
        }
        catch { return null; }
    }

    private async void OpenPmTiles_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog { Filter = "PMTiles (*.pmtiles)|*.pmtiles|All files (*.*)|*.*", Title = "Open PMTiles raster archive" };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            StatusText.Text = "Opening PMTiles archive...";
            var archive = new PmTilesRasterArchive(dialog.FileName);
            await RenderPmTilesAsync(archive);
        }
        catch (Exception ex) { StatusText.Text = $"PMTiles error: {ex.Message}"; }
    }

    private async Task RenderPmTilesAsync(PmTilesRasterArchive archive)
    {
        if (archive.TileType is not (2 or 3)) throw new InvalidDataException($"PMTiles tile type {archive.TileType} is not a raster PNG/JPEG archive.");
        var zoom = archive.CenterZoom;
        var tiles = await archive.ReadRasterTilesAsync(zoom, 2500);
        if (tiles.Count == 0) throw new InvalidDataException("No raster tiles were found at the selected PMTiles zoom level.");

        _offlineTiles.Clear();
        OfflineCanvas.Children.Clear();
        OfflineCanvas.LayoutTransform = null;
        _offlineZoom = zoom;
        _offlineTms = false;
        _offlineFolder = Path.GetDirectoryName(archive.FilePath);
        var minX = tiles.Min(t => t.X); var maxX = tiles.Max(t => t.X);
        var minY = tiles.Min(t => t.Y); var maxY = tiles.Max(t => t.Y);
        OfflineCanvas.Width = Math.Max(256, (maxX - minX + 1) * 256.0);
        OfflineCanvas.Height = Math.Max(256, (maxY - minY + 1) * 256.0);
        foreach (var tile in tiles)
        {
            var image = LoadBitmapFromBytes(tile.Data);
            if (image is null) continue;
            var control = new System.Windows.Controls.Image { Width = 256, Height = 256, Source = image, Stretch = System.Windows.Media.Stretch.Fill, SnapsToDevicePixels = true };
            WpfCanvas.SetLeft(control, (tile.X - minX) * 256.0); WpfCanvas.SetTop(control, (tile.Y - minY) * 256.0);
            OfflineCanvas.Children.Add(control);
        }
        AddOfflineEnglishLabels(zoom, minX, minY, maxX, maxY, 256);
        OfflineScrollViewer.Visibility = Visibility.Visible; MapControl.Visibility = Visibility.Collapsed; ModeStatus.Content = "OFFLINE";
        CoverageText.Text = $"PMTiles • {tiles.Count:N0} raster tiles • Zoom {zoom} • {archive.TileTypeName} • {archive.CompressionName}";
        FileStatus.Content = archive.FilePath;
        StatusText.Text = $"PMTiles loaded: {Path.GetFileName(archive.FilePath)}. Search a city or coordinates.";
        await Task.Yield();
        OfflineScrollViewer.ScrollToHorizontalOffset(Math.Max(0, OfflineCanvas.Width / 2 - OfflineScrollViewer.ViewportWidth / 2));
        OfflineScrollViewer.ScrollToVerticalOffset(Math.Max(0, OfflineCanvas.Height / 2 - OfflineScrollViewer.ViewportHeight / 2));
    }

    private static System.Windows.Media.Imaging.BitmapImage? LoadBitmapFromBytes(byte[] data)
    {
        try
        {
            using var ms = new MemoryStream(data);
            var b = new System.Windows.Media.Imaging.BitmapImage();
            b.BeginInit(); b.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad; b.StreamSource = ms; b.EndInit(); b.Freeze();
            return b;
        }
        catch { return null; }
    }

    private sealed record PmTile(int Z, int X, int Y, byte[] Data);

    private sealed class PmTilesRasterArchive
    {
        public string FilePath { get; }
        public byte TileType { get; }
        public byte CenterZoom { get; }
        public byte InternalCompression { get; }
        public byte TileCompression { get; }
        public string TileTypeName => TileType == 2 ? "PNG" : TileType == 3 ? "JPEG" : $"Type {TileType}";
        public string CompressionName => TileCompression switch { 1 => "none", 2 => "gzip", 3 => "brotli", 4 => "zstd", _ => "unknown" };
        private readonly FileStream _stream;
        private readonly ulong _rootOffset, _rootLength, _leafOffset, _tileOffset;

        public PmTilesRasterArchive(string path)
        {
            FilePath = path; _stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (_stream.Length < 127) throw new InvalidDataException("File is too small to be a PMTiles v3 archive.");
            var h = new byte[127]; ReadAt(0, h);
            if (Encoding.ASCII.GetString(h, 0, 7) != "PMTiles") throw new InvalidDataException("Invalid PMTiles magic.");
            if (h[7] != 3) throw new InvalidDataException($"Unsupported PMTiles version {h[7]}.");
            _rootOffset = U64(h, 8); _rootLength = U64(h, 16); _leafOffset = U64(h, 40); _tileOffset = U64(h, 56);
            InternalCompression = h[97]; TileCompression = h[98]; TileType = h[99]; CenterZoom = h[118];
        }

        public async Task<List<PmTile>> ReadRasterTilesAsync(int zoom, int maxTiles)
        {
            var root = DecodeDirectory(Decompress(ReadAtChecked(_rootOffset, _rootLength), InternalCompression));
            var result = new List<PmTile>();
            await ReadDirectoryAsync(root, zoom, maxTiles, result);
            return result;
        }

        private async Task ReadDirectoryAsync(List<Entry> entries, int zoom, int maxTiles, List<PmTile> result)
        {
            foreach (var entry in entries)
            {
                if (result.Count >= maxTiles) return;
                if (entry.RunLength == 0)
                {
                    var leaf = DecodeDirectory(Decompress(ReadAtChecked(_leafOffset + entry.Offset, entry.Length), InternalCompression));
                    await ReadDirectoryAsync(leaf, zoom, maxTiles, result);
                    continue;
                }
                for (ulong i = 0; i < entry.RunLength && result.Count < maxTiles; i++)
                {
                    var tileId = entry.TileId + i;
                    var zxy = TileIdToZxy(tileId);
                    if (zxy.Z != zoom) continue;
                    var data = Decompress(ReadAtChecked(_tileOffset + entry.Offset, entry.Length), TileCompression);
                    result.Add(new PmTile(zxy.Z, zxy.X, zxy.Y, data));
                }
            }
            await Task.CompletedTask;
        }

        private byte[] ReadAtChecked(ulong offset, ulong length)
        {
            if (length > int.MaxValue) throw new InvalidDataException("PMTiles section is too large.");
            if (offset + length > (ulong)_stream.Length) throw new InvalidDataException("PMTiles section is outside the file.");
            return ReadAt((long)offset, (int)length);
        }
        private byte[] ReadAt(long offset, int length) { var b = new byte[length]; _stream.Position = offset; _stream.ReadExactly(b); return b; }
        private static ulong U64(byte[] b, int o) => BitConverter.ToUInt64(b, o);

        private static byte[] Decompress(byte[] data, byte compression) => compression switch
        {
            0 or 1 => data,
            2 => Gzip(data),
            3 => Brotli(data),
            4 => Zstd(data),
            _ => throw new InvalidDataException($"Unsupported PMTiles compression code {compression}.")
        };
        private static byte[] Gzip(byte[] data) { using var input = new MemoryStream(data); using var gz = new GZipStream(input, CompressionMode.Decompress); using var output = new MemoryStream(); gz.CopyTo(output); return output.ToArray(); }
        private static byte[] Brotli(byte[] data) { using var input = new MemoryStream(data); using var br = new BrotliStream(input, CompressionMode.Decompress); using var output = new MemoryStream(); br.CopyTo(output); return output.ToArray(); }
        private static byte[] Zstd(byte[] data) { using var d = new Decompressor(); return d.Unwrap(data); }

        private sealed record Entry(ulong TileId, ulong Offset, ulong Length, ulong RunLength);
        private static List<Entry> DecodeDirectory(byte[] data)
        {
            var p = 0;
            ulong ReadVar()
            {
                ulong v = 0; int shift = 0;
                while (p < data.Length)
                {
                    var c = data[p++]; v |= (ulong)(c & 127) << shift;
                    if ((c & 128) == 0) return v;
                    shift += 7; if (shift > 63) throw new InvalidDataException("Invalid PMTiles varint.");
                }
                throw new EndOfStreamException();
            }
            var n = ReadVar(); if (n > 1000000) throw new InvalidDataException("PMTiles directory is unreasonably large.");
            var ids = new ulong[n]; var runs = new ulong[n]; var lengths = new ulong[n]; var offsets = new ulong[n];
            ulong last = 0; for (ulong i = 0; i < n; i++) { last += ReadVar(); ids[i] = last; }
            for (ulong i = 0; i < n; i++) runs[i] = ReadVar();
            for (ulong i = 0; i < n; i++) lengths[i] = ReadVar();
            ulong next = 0;
            for (ulong i = 0; i < n; i++) { var v = ReadVar(); offsets[i] = v == 0 && i > 0 ? next : v - 1; next = offsets[i] + lengths[i]; }
            var result = new List<Entry>((int)n);
            for (ulong i = 0; i < n; i++) result.Add(new Entry(ids[i], offsets[i], lengths[i], runs[i]));
            return result;
        }

        private static (int Z, int X, int Y) TileIdToZxy(ulong tileId)
        {
            var z = 0; ulong acc = 0;
            while (z < 27) { var count = 1UL << (2 * z); if (tileId < acc + count) break; acc += count; z++; }
            if (z > 26) throw new InvalidDataException("PMTiles tile zoom exceeds supported range.");
            var t = tileId - acc; var x = 0; var y = 0; var n = 1 << z;
            for (var s = 1; s < n; s <<= 1)
            {
                var rx = ((t / 2) & (ulong)s) != 0 ? 1 : 0;
                var ry = ((t ^ (ulong)(rx * s)) & (ulong)s) != 0 ? 1 : 0;
                (x, y) = Rotate(s, x, y, rx, ry); t /= 4; x += rx * s; y += ry * s;
            }
            return (z, x, y);
        }
        private static (int X, int Y) Rotate(int n, int x, int y, int rx, int ry)
        {
            if (ry == 0) { if (rx != 0) return (n - 1 - y, n - 1 - x); return (y, x); }
            return (x, y);
        }
    }
}
