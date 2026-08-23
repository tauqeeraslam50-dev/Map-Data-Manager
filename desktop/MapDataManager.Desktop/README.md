# Map Data Manager — Native Desktop GIS

This is the new Windows desktop architecture for Map Data Manager.

## Architecture

- **WPF / .NET 9** desktop application
- **Mapsui 5.1** for native map rendering
- **BruTile.MbTiles 6.0** for offline tile access
- **SQLite / MBTiles** as the application-managed offline map format
- No browser map renderer
- No Electron
- No localhost HTTP/HTTPS tile server
- No IndexedDB
- No CORS dependency

## Offline workflow

1. Click **Select Offline Map Folder**.
2. Select a folder containing standard XYZ tiles:

```text
MapFolder/
  5/
    17/
      12.png
      13.png
  6/
    ...
```

3. The application recursively scans the folder.
4. It converts the XYZ folder into an MBTiles database under the user's LocalAppData folder.
5. Mapsui opens that MBTiles database natively.
6. The map automatically zooms to the MBTiles extent.

Existing `.mbtiles`, `.sqlite`, and `.db` files can also be opened directly with **Open MBTiles**.

## Build

Requires the .NET 9 SDK and Windows.

```powershell
cd desktop\MapDataManager.Desktop
dotnet restore
dotnet build
dotnet run
```

The first build downloads the Mapsui/SkiaSharp/SQLite dependencies from NuGet.
