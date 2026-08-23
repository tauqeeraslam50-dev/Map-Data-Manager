using System.IO;
using System.Windows;
using Microsoft.Win32;
using Mapsui;
using Mapsui.Tiling;

namespace MapDataManager;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        var map = new Map();
        map.Layers.Add(OpenStreetMap.CreateTileLayer());
        MapControl.Map = map;
        StatusText.Text = "Native GIS engine ready. Online base map loaded for testing.";
    }

    private void SelectFolder_Click(object sender, RoutedEventArgs e)
    {
        // WPF has no built-in FolderBrowserDialog. Use the Windows Shell picker
        // through the OpenFolderDialog available in modern Windows App SDK/WPF.
        var dialog = new OpenFolderDialog
        {
            Title = "Select the folder containing offline XYZ/TMS map tiles",
            Multiselect = false
        };

        if (dialog.ShowDialog() != true)
            return;

        var folder = dialog.FolderName;
        var files = Directory.EnumerateFiles(folder, "*.*", SearchOption.AllDirectories)
            .Where(IsRasterTile)
            .ToList();

        FileStatus.Content = folder;
        CoverageText.Text = $"{files.Count:N0} raster tiles detected";
        StatusText.Text = files.Count == 0
            ? "No PNG/JPEG/WEBP tiles were found in the selected folder."
            : "Offline dataset detected. Offline renderer integration is the next module.";
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
        StatusText.Text = "Select an offline XYZ/TMS folder.";
    }

    private void OnlineMap_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Online Map";
        StatusText.Text = "Online OpenStreetMap base layer is active.";
    }

    private void MapData_Click(object sender, RoutedEventArgs e)
    {
        PageTitle.Text = "Map Data";
        StatusText.Text = "Map data management will be implemented here.";
    }
}
