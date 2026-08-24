using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PMTiles;

namespace MapDataManager;

/// <summary>
/// Streams raster PNG/JPEG tiles from a PMTiles v3 archive into the existing WPF
/// offline-map canvas. Only tiles in/near the visible viewport are decoded, so a
/// 1+ GB archive is not expanded into thousands of files or loaded into memory.
/// </summary>
public sealed class PMTilesRasterController : IAsyncDisposable
{
    private const double TileSize = 256.0;
    private const int ViewMarginTiles = 1;

    private PMTilesReader? _reader;
    private Header? _header;
    private Canvas? _canvas;
    private ScrollViewer? _viewer;
    private int _zoom;
    private int _minX;
    private int _minY;
    private int _maxX;
    private int _maxY;
    private long _renderGeneration;
    private bool _rendering;
    private readonly Dictionary<string, Image> _images = new(StringComparer.Ordinal);

    public bool IsOpen => _reader is not null && _header is not null;
    public int Zoom => _zoom;
    public int MinZoom => _header?.MinZoom ?? 0;
    public int MaxZoom => _header?.MaxZoom ?? 0;
    public Header? Header => _header;

    public async Task OpenAsync(string path, Canvas canvas, ScrollViewer viewer, double centerLat, double centerLon)
    {
        await DisposeReaderAsync();
        _canvas = canvas;
        _viewer = viewer;
        _canvas.Children.Clear();
        _images.Clear();

        var reader = PMTilesReader.FromFile(path);
        if (reader is null)
            throw new FileNotFoundException("PMTiles file was not found.", path);

        _reader = reader;
        _header = await reader.GetHeader();

        if (_header.TileType is not (TileType.Png or TileType.Jpeg))
        {
            var type = _header.TileType.ToString();
            await DisposeReaderAsync();
            throw new NotSupportedException(
                $"This PMTiles archive contains {type} tiles. The current WPF raster renderer accepts PNG/JPEG PMTiles. " +
                "Vector PMTiles require a vector rendering style and are not raster images.");
        }

        _zoom = Math.Clamp(_header.CenterZoom, _header.MinZoom, _header.MaxZoom);
        RecalculateBounds();
        SetCanvasSize();
        _viewer.ScrollChanged += Viewer_ScrollChanged;

        await RenderViewportAsync();
        CenterOn(centerLat, centerLon);
        await RenderViewportAsync();
    }

    public async Task ZoomInAsync()
    {
        if (!IsOpen || _zoom >= MaxZoom) return;
        var center = GetViewportCenterWorld();
        _zoom++;
        RecalculateBounds();
        SetCanvasSize();
        await RenderViewportAsync();
        CenterOn(center.lat, center.lon);
    }

    public async Task ZoomOutAsync()
    {
        if (!IsOpen || _zoom <= MinZoom) return;
        var center = GetViewportCenterWorld();
        _zoom--;
        RecalculateBounds();
        SetCanvasSize();
        await RenderViewportAsync();
        CenterOn(center.lat, center.lon);
    }

    public async Task ResetAsync()
    {
        if (!IsOpen || _header is null) return;
        _zoom = Math.Clamp(_header.CenterZoom, _header.MinZoom, _header.MaxZoom);
        RecalculateBounds();
        SetCanvasSize();
        await RenderViewportAsync();
        CenterOn(_header.CenterLat, _header.CenterLon);
        await RenderViewportAsync();
    }

    public void CenterOn(double lat, double lon)
    {
        if (!IsOpen) return;
        var n = Math.Pow(2, _zoom);
        var x = (lon + 180.0) / 360.0 * n;
        var y = LatToWorldY(lat, n);
        var px = (x - _minX) * TileSize;
        var py = (y - _minY) * TileSize;
        _viewer?.ScrollToHorizontalOffset(Math.Max(0, px - _viewer.ViewportWidth / 2));
        _viewer?.ScrollToVerticalOffset(Math.Max(0, py - _viewer.ViewportHeight / 2));
    }

    private (double lon, double lat) GetViewportCenterWorld()
    {
        if (_viewer is null) return (0, 0);
        var cx = (_viewer.HorizontalOffset + _viewer.ViewportWidth / 2) / TileSize + _minX;
        var cy = (_viewer.VerticalOffset + _viewer.ViewportHeight / 2) / TileSize + _minY;
        var n = Math.Pow(2, _zoom);
        var lon = cx / n * 360.0 - 180.0;
        var lat = WorldYToLat(cy, n);
        return (lon, lat);
    }

    private void RecalculateBounds()
    {
        if (_header is null) return;
        var n = Math.Pow(2, _zoom);
        _minX = Math.Clamp((int)Math.Floor((_header.MinLon + 180.0) / 360.0 * n), 0, (int)n - 1);
        _maxX = Math.Clamp((int)Math.Floor((_header.MaxLon + 180.0) / 360.0 * n), 0, (int)n - 1);
        _minY = Math.Clamp((int)Math.Floor(LatToWorldY(_header.MaxLat, n)), 0, (int)n - 1);
        _maxY = Math.Clamp((int)Math.Floor(LatToWorldY(_header.MinLat, n)), 0, (int)n - 1);
        if (_maxX < _minX) (_minX, _maxX) = (_maxX, _minX);
        if (_maxY < _minY) (_minY, _maxY) = (_maxY, _minY);
    }

    private void SetCanvasSize()
    {
        if (_canvas is null) return;
        _canvas.Width = Math.Max(TileSize, (_maxX - _minX + 1) * TileSize);
        _canvas.Height = Math.Max(TileSize, (_maxY - _minY + 1) * TileSize);
    }

    private async void Viewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (e.HorizontalChange == 0 && e.VerticalChange == 0) return;
        await RenderViewportAsync();
    }

    private async Task RenderViewportAsync()
    {
        if (!IsOpen || _reader is null || _canvas is null || _viewer is null || _rendering)
            return;

        _rendering = true;
        var generation = ++_renderGeneration;
        try
        {
            var firstX = Math.Max(_minX, _minX + (int)Math.Floor(_viewer.HorizontalOffset / TileSize) - ViewMarginTiles);
            var firstY = Math.Max(_minY, _minY + (int)Math.Floor(_viewer.VerticalOffset / TileSize) - ViewMarginTiles);
            var lastX = Math.Min(_maxX, _minX + (int)Math.Floor((_viewer.HorizontalOffset + Math.Max(1, _viewer.ViewportWidth)) / TileSize) + ViewMarginTiles);
            var lastY = Math.Min(_maxY, _minY + (int)Math.Floor((_viewer.VerticalOffset + Math.Max(1, _viewer.ViewportHeight)) / TileSize) + ViewMarginTiles);

            var wanted = new HashSet<string>(StringComparer.Ordinal);
            for (var x = firstX; x <= lastX; x++)
            {
                for (var y = firstY; y <= lastY; y++)
                    wanted.Add(TileKey(_zoom, x, y));
            }

            foreach (var key in _images.Keys.Where(k => !wanted.Contains(k)).ToList())
            {
                _canvas.Children.Remove(_images[key]);
                _images.Remove(key);
            }

            var requests = new List<Task<(string Key, int X, int Y, byte[]? Data)>>();
            for (var x = firstX; x <= lastX; x++)
            {
                for (var y = firstY; y <= lastY; y++)
                {
                    var key = TileKey(_zoom, x, y);
                    if (_images.ContainsKey(key)) continue;
                    requests.Add(LoadTileAsync(key, _zoom, x, y));
                }
            }

            var results = await Task.WhenAll(requests);
            if (generation != _renderGeneration || !IsOpen) return;

            foreach (var result in results)
            {
                if (result.Data is null || _images.ContainsKey(result.Key)) continue;
                var source = DecodeImage(result.Data);
                if (source is null) continue;

                var image = new Image
                {
                    Width = TileSize,
                    Height = TileSize,
                    Stretch = Stretch.Fill,
                    Source = source,
                    SnapsToDevicePixels = true,
                    IsHitTestVisible = false
                };
                Canvas.SetLeft(image, (result.X - _minX) * TileSize);
                Canvas.SetTop(image, (result.Y - _minY) * TileSize);
                _canvas.Children.Add(image);
                _images[result.Key] = image;
            }
        }
        finally
        {
            _rendering = false;
        }
    }

    private async Task<(string Key, int X, int Y, byte[]? Data)> LoadTileAsync(string key, int z, int x, int y)
    {
        try
        {
            var bytes = await _reader!.GetTileZxyAsBytes(z, x, y);
            return (key, x, y, bytes);
        }
        catch
        {
            return (key, x, y, null);
        }
    }

    private static BitmapImage? DecodeImage(byte[] data)
    {
        try
        {
            using var stream = new MemoryStream(data, writable: false);
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

    private static string TileKey(int z, int x, int y) => string.Create(CultureInfo.InvariantCulture, $"{z}/{x}/{y}");

    private static double LatToWorldY(double lat, double n)
    {
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180.0;
        return (1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n;
    }

    private static double WorldYToLat(double y, double n)
    {
        var mercatorY = Math.PI * (1.0 - 2.0 * y / n);
        return 180.0 / Math.PI * Math.Atan(Math.Sinh(mercatorY));
    }

    private async Task DisposeReaderAsync()
    {
        if (_viewer is not null)
            _viewer.ScrollChanged -= Viewer_ScrollChanged;
        if (_reader is not null)
            await _reader.DisposeAsync();
        _reader = null;
        _header = null;
        _images.Clear();
    }

    public async ValueTask DisposeAsync() => await DisposeReaderAsync();
}
