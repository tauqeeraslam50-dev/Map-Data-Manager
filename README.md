# Map Data Manager

This repository contains the Map Data Manager project.

## New primary architecture — Native Windows GIS

The offline map engine is being rebuilt as a **native WPF/.NET desktop application** instead of the previous browser/Electron architecture.

- WPF / .NET 9
- Mapsui 5.1 native renderer
- BruTile MBTiles support
- SQLite-backed offline map storage
- XYZ folder → MBTiles importer
- No browser filesystem dependency
- No localhost tile server
- No CORS or HTTPS certificate dependency
- Designed for standalone offline GIS use on Windows

The new desktop application is located at:

```text
desktop/MapDataManager.Desktop/
```

## Run the new desktop application

Requires the .NET 9 SDK on Windows.

```powershell
cd "desktop\MapDataManager.Desktop"
dotnet restore
dotnet build
dotnet run
```

### Offline map workflow

Select a folder containing standard XYZ tiles:

```text
MapFolder/
  5/
    17/
      12.png
      13.png
  6/
    ...
```

The application scans the complete folder, converts the tiles to an MBTiles database in the user's local application data, and opens that database directly in Mapsui. Existing MBTiles files can also be opened directly.

## Legacy AI Studio web application

The original React/Vite application remains in the repository while the native desktop GIS engine is developed and validated. It is not the primary offline-map architecture going forward.
