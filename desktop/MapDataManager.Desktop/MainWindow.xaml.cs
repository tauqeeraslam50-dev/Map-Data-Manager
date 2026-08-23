using System.Diagnostics;
using System.Windows;
using Mapsui;
using Mapsui.Tiling.Layers;
using BruTile.MbTiles;
using SQLite;
using MapDataManager.Desktop.Services;
using Forms = System.Windows.Forms;

namespace MapDataManager.Desktop;

public partial class MainWindow : Window
{
    private readonly OfflineMapImporter _importer = new();
    private Mapsui.Map? _map;
    private TileLayer? _offlineLayer;
    private string? _currentMbTiles;

    public MainWindow()
    {
        InitializeComponent();
        StatusText.Text = "Select a folder containing z\\x\\y.png tiles.";
    }

    private async void SelectFolder_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new Forms.FolderBrowserDialog
        {
            Description = "Select the root folder containing XYZ map tiles (z\\x\\y.png)",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        if (dialog.ShowDialog() != Forms.DialogResult.OK) return;

        try
        {
            SetBusy(true, $"Scanning {dialog.SelectedPath} ...");
            FolderText.Text = dialog.SelectedPath;
            FormatText.Text = "XYZ folder → MBTiles";

            var appData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PakLink", "MapDataManager", "OfflineMaps");
            Directory.CreateDirectory(appData);
            var mbtiles = Path.Combine(appData, "imported-map.mbtiles");

            var progress = new Progress<int>(p =>
            {
                ImportProgress.Value = p;
                StatusText.Text = $"Importing tiles... {p}%";
            });

            var result = await _importer.ImportXyzFolderAsync(dialog.SelectedPath, mbtiles, progress);
            _currentMbTiles = result.MbTilesPath;

            TilesText.Text = result.TileCount.ToString("N0");
            ZoomText.Text = $"{result.MinZoom} – {result.MaxZoom}";
            BoundsText.Text = $"{result.MinLongitude:F5}, {result.MinLatitude:F5}\n{result.MaxLongitude:F5}, {result.MaxLatitude:F5}";

            LoadMbTiles(result.MbTilesPath);
            StatusText.Text = "Offline map loaded successfully.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Import failed: " + ex.Message;
            MessageBox.Show(this, ex.ToString(), "Offline map import error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            SetBusy(false, StatusText.Text);
        }
    }

    private void LoadMbTiles_Click(object sender, RoutedEventArgs e)
    {
        using var dialog = new Forms.OpenFileDialog
        {
            Title = "Open offline MBTiles map",
            Filter = "MBTiles (*.mbtiles;*.sqlite;*.db)|*.mbtiles;*.sqlite;*.db|All files (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog() != Forms.DialogResult.OK) return;

        try
        {
            _currentMbTiles = dialog.FileName;
            FolderText.Text = dialog.FileName;
            FormatText.Text = "MBTiles";
            LoadMbTiles(dialog.FileName);
            StatusText.Text = "MBTiles opened successfully.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Could not open MBTiles: " + ex.Message;
            MessageBox.Show(this, ex.ToString(), "MBTiles error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void LoadMbTiles(string path)
    {
        var tileSource = new MbTilesTileSource(new SQLiteConnectionString(path, true));
        var layer = new TileLayer(tileSource) { Name = "Offline MBTiles" };

        _map = new Mapsui.Map();
        _offlineLayer = layer;
        _map.Layers.Add(layer);
        MapControl.Map = _map;

        Loaded += (_, _) => ZoomToExtent(tileSource.Extent);
        Dispatcher.BeginInvoke(ZoomToExtent, System.Windows.Threading.DispatcherPriority.Loaded, tileSource.Extent);
    }

    private void ZoomToExtent(MRect? extent)
    {
        if (extent is null || _map is null) return;
        try
        {
            _map.Navigator.ZoomToBox(extent, MBoxFit.Fit);
        }
        catch
        {
            // Mapsui may not have a realized viewport on the first call; a later layout pass will retry.
            Dispatcher.BeginInvoke(ZoomToExtent, System.Windows.Threading.DispatcherPriority.Background, extent);
        }
    }

    private void ClearMap_Click(object sender, RoutedEventArgs e)
    {
        _map = new Mapsui.Map();
        _offlineLayer = null;
        _currentMbTiles = null;
        MapControl.Map = _map;
        FolderText.Text = "No folder selected";
        FormatText.Text = "—";
        TilesText.Text = "0";
        ZoomText.Text = "—";
        BoundsText.Text = "—";
        StatusText.Text = "Ready";
        ImportProgress.Value = 0;
        ImportProgress.Visibility = Visibility.Collapsed;
    }

    private void SetBusy(bool busy, string message)
    {
        ImportProgress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Text = message;
        Cursor = busy ? System.Windows.Input.Cursors.Wait : System.Windows.Input.Cursors.Arrow;
    }
}
