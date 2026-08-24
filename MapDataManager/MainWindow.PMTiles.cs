using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using Forms = System.Windows.Forms;

namespace MapDataManager;

public partial class MainWindow
{
    private readonly PMTilesRasterController _pmTiles = new();

    private async void SelectPMTiles_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new Forms.OpenFileDialog
        {
            Title = "Open PMTiles raster archive",
            Filter = "PMTiles files (*.pmtiles)|*.pmtiles|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };

        if (dialog.ShowDialog() != Forms.DialogResult.OK || string.IsNullOrWhiteSpace(dialog.FileName))
            return;

        try
        {
            StatusText.Text = "Opening PMTiles archive and reading header...";
            CoverageText.Text = "Reading PMTiles metadata...";
            await _pmTiles.OpenAsync(dialog.FileName, OfflineCanvas, OfflineScrollViewer, 33.6844, 73.0479);

            MapControl.Visibility = Visibility.Collapsed;
            OfflineScrollViewer.Visibility = Visibility.Visible;
            ModeStatus.Content = "OFFLINE PMTILES";
            PageTitle.Text = "Offline PMTiles Map";
            FileStatus.Content = dialog.FileName;
            FolderButton.Content = "Select Map Folder";
            CoverageText.Text = $"PMTiles raster • {_pmTiles.Header!.TileType} • Zoom {_pmTiles.MinZoom}–{_pmTiles.MaxZoom} • current {_pmTiles.Zoom}";
            StatusText.Text = $"PMTiles loaded. Real tile zoom {_pmTiles.Zoom}; use + / − to change PMTiles zoom level.";
            RenderPMTilesPlaceLabels();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"PMTiles load failed: {ex.Message}";
            CoverageText.Text = "PMTiles could not be opened.";
        }
    }

    private async void PMTilesZoomIn_Click(object sender, RoutedEventArgs e)
    {
        if (!_pmTiles.IsOpen)
        {
            ZoomIn_Click(sender, e);
            return;
        }

        await _pmTiles.ZoomInAsync();
        RenderPMTilesPlaceLabels();
        UpdatePMTilesStatus();
    }

    private async void PMTilesZoomOut_Click(object sender, RoutedEventArgs e)
    {
        if (!_pmTiles.IsOpen)
        {
            ZoomOut_Click(sender, e);
            return;
        }

        await _pmTiles.ZoomOutAsync();
        RenderPMTilesPlaceLabels();
        UpdatePMTilesStatus();
    }

    private async void PMTilesZoomHome_Click(object sender, RoutedEventArgs e)
    {
        if (!_pmTiles.IsOpen)
        {
            ZoomHome_Click(sender, e);
            return;
        }

        await _pmTiles.ResetAsync();
        RenderPMTilesPlaceLabels();
        UpdatePMTilesStatus();
    }

    private async void PMTilesSearch_Click(object sender, RoutedEventArgs e)
    {
        if (!_pmTiles.IsOpen)
        {
            await SearchAsync();
            return;
        }

        CenterPMTilesSearch();
    }

    private async void PMTilesSearchBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Enter) return;
        if (!_pmTiles.IsOpen)
        {
            await SearchAsync();
            return;
        }

        CenterPMTilesSearch();
    }

    private void PMTilesGoTo_Click(object sender, RoutedEventArgs e)
    {
        if (!_pmTiles.IsOpen)
        {
            Phase1GoTo_Click(sender, e);
            return;
        }

        CenterPMTilesSearch();
    }

    private void CenterPMTilesSearch()
    {
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query)) return;

        if (TryParseCoordinates(query, out var lat, out var lon))
        {
            _pmTiles.CenterOn(lat, lon);
            StatusText.Text = $"PMTiles search: {lat:F6}, {lon:F6} • Zoom {_pmTiles.Zoom}";
            return;
        }

        var place = PakistanPlaces.FirstOrDefault(p =>
            p.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
            query.Contains(p.Name, StringComparison.OrdinalIgnoreCase));

        if (place is null)
        {
            StatusText.Text = "Offline PMTiles search: place not found in the local Pakistan gazetteer.";
            return;
        }

        _pmTiles.CenterOn(place.Latitude, place.Longitude);
        StatusText.Text = $"PMTiles search: {place.Name} ({place.Latitude:F4}, {place.Longitude:F4}) • Zoom {_pmTiles.Zoom}";
    }

    private void RenderPMTilesPlaceLabels()
    {
        if (!_pmTiles.IsOpen || _pmTiles.Header is null) return;

        foreach (var child in OfflineCanvas.Children.OfType<TextBlock>().Where(x => Equals(x.Tag, "pmtiles-label")).ToList())
            OfflineCanvas.Children.Remove(child);

        var header = _pmTiles.Header;
        var n = Math.Pow(2, _pmTiles.Zoom);
        var minX = Math.Clamp((int)Math.Floor((header.MinLon + 180.0) / 360.0 * n), 0, (int)n - 1);
        var minY = Math.Clamp((int)Math.Floor(LatToWorldY(header.MaxLat, n)), 0, (int)n - 1);
        var maxX = Math.Clamp((int)Math.Floor((header.MaxLon + 180.0) / 360.0 * n), 0, (int)n - 1);
        var maxY = Math.Clamp((int)Math.Floor(LatToWorldY(header.MinLat, n)), 0, (int)n - 1);

        foreach (var place in PakistanPlaces)
        {
            if (place.Longitude < header.MinLon || place.Longitude > header.MaxLon ||
                place.Latitude < header.MinLat || place.Latitude > header.MaxLat)
                continue;

            var x = (place.Longitude + 180.0) / 360.0 * n;
            var y = LatToWorldY(place.Latitude, n);
            var px = (x - minX) * 256.0 + 6;
            var py = (y - minY) * 256.0 - 10;
            if (px < -200 || py < -100 || px > OfflineCanvas.Width + 200 || py > OfflineCanvas.Height + 100)
                continue;

            var label = new TextBlock
            {
                Text = place.Name,
                Tag = "pmtiles-label",
                Foreground = System.Windows.Media.Brushes.White,
                Background = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromArgb(205, 15, 23, 42)),
                FontSize = _pmTiles.Zoom >= 11 ? 13 : _pmTiles.Zoom >= 8 ? 11 : 10,
                FontWeight = FontWeights.SemiBold,
                Padding = new Thickness(3, 1, 3, 1),
                IsHitTestVisible = false
            };
            Canvas.SetLeft(label, px);
            Canvas.SetTop(label, py);
            Panel.SetZIndex(label, 100);
            OfflineCanvas.Children.Add(label);
        }
    }

    private static double LatToWorldY(double lat, double n)
    {
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180.0;
        return (1.0 - Math.Log(Math.Tan(latRad) + 1.0 / Math.Cos(latRad)) / Math.PI) / 2.0 * n;
    }

    private void UpdatePMTilesStatus()
    {
        if (!_pmTiles.IsOpen || _pmTiles.Header is null) return;
        CoverageText.Text = $"PMTiles raster • {_pmTiles.Header.TileType} • Zoom {_pmTiles.MinZoom}–{_pmTiles.MaxZoom} • current {_pmTiles.Zoom}";
        StatusText.Text = $"PMTiles map zoom {_pmTiles.Zoom}/{_pmTiles.MaxZoom}. Higher zoom levels now request the archive's real tiles instead of enlarging one image.";
    }

    protected override async void OnClosed(EventArgs e)
    {
        await _pmTiles.DisposeAsync();
        base.OnClosed(e);
    }
}
