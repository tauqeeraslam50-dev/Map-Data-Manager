using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Mapsui;

namespace MapDataManager;

public partial class MainWindow
{
    private bool _phase1HighlightVisible;

    private async void Phase1GoTo_Click(object sender, RoutedEventArgs e)
    {
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query))
        {
            StatusText.Text = "Enter coordinates such as 33.6844, 73.0479 or a place name first.";
            return;
        }

        await SearchAsync();
        await Task.Delay(500);
        ShowPhase1Highlight("GO-TO RESULT");
    }

    private void MapControl_MapPointerMoved(object? sender, Mapsui.MapEventArgs e)
    {
        if (ModeStatus.Content?.ToString() != "ONLINE") return;

        var (lat, lon) = Phase1FromWebMercator(e.WorldPosition.X, e.WorldPosition.Y);
        UpdateCoordinateReadout(lat, lon);
    }

    private void OfflineMap_MouseMove(object sender, MouseEventArgs e)
    {
        if (_offlineTiles.Count == 0 || _offlineZoom < 0) return;

        try
        {
            var point = e.GetPosition(OfflineCanvas);
            var scale = Math.Max(0.0001, _offlineScale);
            var px = point.X / scale;
            var py = point.Y / scale;
            var tiles = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
            if (tiles.Count == 0) return;

            var minX = tiles.Min(t => t.X);
            var minY = tiles.Min(t => t.Y);
            var tileX = minX + px / 256.0;
            var tileY = minY + py / 256.0;
            var n = Math.Pow(2, _offlineZoom);
            if (_offlineTms) tileY = n - 1 - tileY;

            var lon = tileX / n * 360.0 - 180.0;
            var mercatorY = Math.PI * (1.0 - 2.0 * tileY / n);
            var lat = 180.0 / Math.PI * Math.Atan(Math.Sinh(mercatorY));
            UpdateCoordinateReadout(lat, lon);
        }
        catch
        {
            // Ignore transient pointer/scroll state while the canvas is being rebuilt.
        }
    }

    private void UpdateCoordinateReadout(double lat, double lon)
    {
        if (double.IsNaN(lat) || double.IsNaN(lon) || double.IsInfinity(lat) || double.IsInfinity(lon)) return;
        lat = Math.Clamp(lat, -90, 90);
        lon = Math.Clamp(lon, -180, 180);
        var text = $"Lat {lat:F6}, Lon {lon:F6}";
        MouseCoordinateText.Text = $"Cursor: {text}";
        CoordinateStatus.Content = text;
    }

    private void ShowPhase1Highlight(string title)
    {
        try
        {
            double lat;
            double lon;

            if (ModeStatus.Content?.ToString() == "ONLINE")
            {
                var viewport = MapControl.Map.Navigator.Viewport;
                (lat, lon) = Phase1FromWebMercator(viewport.CenterX, viewport.CenterY);
            }
            else
            {
                var tiles = _offlineTiles.Where(t => t.Z == _offlineZoom).ToList();
                if (tiles.Count == 0) return;

                var minX = tiles.Min(t => t.X);
                var minY = tiles.Min(t => t.Y);
                var centerPx = OfflineScrollViewer.HorizontalOffset / Math.Max(0.0001, _offlineScale)
                               + OfflineScrollViewer.ViewportWidth / (2.0 * Math.Max(0.0001, _offlineScale));
                var centerPy = OfflineScrollViewer.VerticalOffset / Math.Max(0.0001, _offlineScale)
                               + OfflineScrollViewer.ViewportHeight / (2.0 * Math.Max(0.0001, _offlineScale));
                var tileX = minX + centerPx / 256.0;
                var tileY = minY + centerPy / 256.0;
                var n = Math.Pow(2, _offlineZoom);
                if (_offlineTms) tileY = n - 1 - tileY;
                lon = tileX / n * 360.0 - 180.0;
                var mercatorY = Math.PI * (1.0 - 2.0 * tileY / n);
                lat = 180.0 / Math.PI * Math.Atan(Math.Sinh(mercatorY));
            }

            Phase1MarkerTitle.Text = title;
            Phase1MarkerCoordinates.Text = $"{lat:F6}, {lon:F6}";
            Phase1Highlight.Visibility = Visibility.Visible;
            _phase1HighlightVisible = true;
            UpdateCoordinateReadout(lat, lon);
        }
        catch
        {
            // Highlight is an enhancement; it must never prevent map operation.
        }
    }

    private static (double Lat, double Lon) Phase1FromWebMercator(double x, double y)
    {
        const double radius = 6378137.0;
        var lon = x / radius * 180.0 / Math.PI;
        var lat = (2.0 * Math.Atan(Math.Exp(y / radius)) - Math.PI / 2.0) * 180.0 / Math.PI;
        return (lat, lon);
    }

    [ModuleInitializer]
    internal static void RegisterPhase1Handlers()
    {
        EventManager.RegisterClassHandler(
            typeof(Button),
            Button.ClickEvent,
            new RoutedEventHandler(Phase1ButtonObserver),
            true);

        EventManager.RegisterClassHandler(
            typeof(TextBox),
            TextBox.KeyDownEvent,
            new KeyEventHandler(Phase1SearchBoxObserver),
            true);
    }

    private static void Phase1ButtonObserver(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Content?.ToString() != "SEARCH") return;
        if (Window.GetWindow(button) is not MainWindow window) return;

        window.Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(async () =>
        {
            await Task.Delay(600);
            if (!window.IsLoaded) return;
            window.ShowPhase1Highlight("SEARCH RESULT");
        }));
    }

    private static void Phase1SearchBoxObserver(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || sender is not TextBox textBox || textBox.Name != "SearchBox") return;
        if (Window.GetWindow(textBox) is not MainWindow window) return;

        window.Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(async () =>
        {
            await Task.Delay(600);
            if (!window.IsLoaded) return;
            window.ShowPhase1Highlight("SEARCH RESULT");
        }));
    }
}
