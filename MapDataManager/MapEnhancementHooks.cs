using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using Mapsui.Styles;

namespace MapDataManager;

internal static class MapEnhancementHooks
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        EventManager.RegisterClassHandler(typeof(Button), Button.ClickEvent, new RoutedEventHandler(HandleButtonClick));
    }

    private static void HandleButtonClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Content?.ToString() != "PMTILES") return;
        if (Window.GetWindow(button) is not MainWindow window) return;
        e.Handled = true;
        window.GetType().GetMethod("OpenPmTiles_Click", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.Invoke(window, new object[] { button, e });
    }
}

internal static class MapsuiColorExtensions
{
    internal static Color WithAlpha(this Color color, int alpha) => Color.FromArgb(Math.Clamp(alpha, 0, 255), color.R, color.G, color.B);
}
