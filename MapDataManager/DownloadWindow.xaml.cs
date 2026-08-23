using System.Globalization;
using System.Windows;
using System.Windows.Controls;

namespace MapDataManager;

public partial class DownloadWindow : Window
{
    public string DatasetName { get; private set; } = "Pakistan-OSM";
    public double West { get; private set; }
    public double East { get; private set; }
    public double South { get; private set; }
    public double North { get; private set; }
    public int MinZoom { get; private set; }
    public int MaxZoom { get; private set; }

    public DownloadWindow()
    {
        InitializeComponent();
        ApplyPreset(0);
        UpdateEstimate();
    }

    private void PresetBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!IsInitialized) return;
        ApplyPreset(PresetBox.SelectedIndex);
        UpdateEstimate();
    }

    private void ApplyPreset(int index)
    {
        switch (index)
        {
            case 1:
                SetBounds("72.75", "73.30", "33.35", "33.90", "Islamabad-Rawalpindi-OSM");
                break;
            case 2:
                SetBounds("73.90", "74.70", "31.15", "31.75", "Lahore-OSM");
                break;
            case 3:
                SetBounds("66.55", "67.35", "24.55", "25.25", "Karachi-OSM");
                break;
            default:
                SetBounds("60.80", "77.10", "23.50", "37.20", "Pakistan-OSM");
                break;
        }
    }

    private void SetBounds(string west, string east, string south, string north, string name)
    {
        WestBox.Text = west;
        EastBox.Text = east;
        SouthBox.Text = south;
        NorthBox.Text = north;
        DatasetBox.Text = name;
    }

    private void Download_Click(object sender, RoutedEventArgs e)
    {
        if (!double.TryParse(WestBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var west) ||
            !double.TryParse(EastBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var east) ||
            !double.TryParse(SouthBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var south) ||
            !double.TryParse(NorthBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var north))
        {
            MessageBox.Show("Enter valid numeric coordinates.", "Invalid coordinates", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        if (!int.TryParse(((ComboBoxItem)MinZoomBox.SelectedItem).Content.ToString(), out var minZoom) ||
            !int.TryParse(((ComboBoxItem)MaxZoomBox.SelectedItem).Content.ToString(), out var maxZoom))
        {
            MessageBox.Show("Select valid zoom levels.", "Invalid zoom", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        if (west < -180 || east > 180 || south < -85 || north > 85 || west >= east || south >= north)
        {
            MessageBox.Show("Coordinates are invalid. West must be less than East and South less than North.", "Invalid bounds", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        if (minZoom > maxZoom)
        {
            MessageBox.Show("Minimum zoom cannot be greater than maximum zoom.", "Invalid zoom", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        if (string.IsNullOrWhiteSpace(DatasetBox.Text))
        {
            MessageBox.Show("Enter a dataset name.", "Dataset name", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        West = west;
        East = east;
        South = south;
        North = north;
        MinZoom = minZoom;
        MaxZoom = maxZoom;
        DatasetName = string.Join("-", DatasetBox.Text.Trim().Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(DatasetName)) DatasetName = "OfflineMap";

        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void UpdateEstimate()
    {
        if (!IsInitialized || MinZoomBox.SelectedItem is not ComboBoxItem minItem || MaxZoomBox.SelectedItem is not ComboBoxItem maxItem)
            return;

        if (!int.TryParse(minItem.Content.ToString(), out var minZoom) || !int.TryParse(maxItem.Content.ToString(), out var maxZoom))
            return;

        if (!double.TryParse(WestBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var west) ||
            !double.TryParse(EastBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var east) ||
            !double.TryParse(SouthBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var south) ||
            !double.TryParse(NorthBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var north))
            return;

        long total = 0;
        for (var z = minZoom; z <= maxZoom; z++)
        {
            var n = 1L << z;
            var minX = (long)Math.Floor((west + 180) / 360 * n);
            var maxX = (long)Math.Floor((east + 180) / 360 * n);
            var minY = LatToY(north, z);
            var maxY = LatToY(south, z);
            total += Math.Max(0, maxX - minX + 1) * Math.Max(0, maxY - minY + 1);
        }

        EstimateText.Text = $"Estimated tiles: {total:N0}. Higher zoom levels can increase the download size very quickly.";
    }

    private static long LatToY(double lat, int z)
    {
        var n = Math.Pow(2, z);
        var latRad = Math.Clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
        return (long)Math.Floor((1 - Math.Log(Math.Tan(latRad) + 1 / Math.Cos(latRad)) / Math.PI) / 2 * n);
    }
}
