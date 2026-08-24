using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;

namespace MapDataManager;

public partial class App : System.Windows.Application
{
    private static string LogDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "MapDataManager", "Logs");

    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += (_, args) =>
        {
            LogException(args.Exception, "DispatcherUnhandledException");
            MessageBox.Show(
                "Map Data Manager encountered an unexpected error. The error was logged locally.\n\n" + args.Exception.Message,
                "Map Data Manager", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            LogException(args.Exception, "UnobservedTaskException");
            args.SetObserved();
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
                LogException(ex, "AppDomain.UnhandledException");
        };

        base.OnStartup(e);
    }

    private static void LogException(Exception exception, string source)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            var file = Path.Combine(LogDirectory, "errors.log");
            File.AppendAllText(file,
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {source}\n{exception}\n\n");
        }
        catch
        {
            // Never allow diagnostic logging to crash the application.
        }
    }
}
