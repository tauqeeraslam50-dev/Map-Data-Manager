# Map Data Manager

This repository is the **original Google AI Studio Map Data Manager** project.

## Important project identity

- Repository: `tauqeeraslam50-dev/Map-Data-Manager`
- Package name: `map-data-manager`
- This is **not** the Radio Network Management System (RNMS).
- Do not run this project from an RNMS folder such as `D:\Alpha2`.

## Run locally

Extract/clone this repository into its own folder, for example:

```powershell
cd "D:\Map-Data-Manager"
npm.cmd install
npm.cmd run dev
```

The development server uses port **5173**:

```text
http://localhost:5173/
```

If `package.json` shows `radio-network-management-system`, you are in the wrong folder.

## Current functionality

- React + Vite application
- MapLibre map viewer
- PMTiles package management
- IndexedDB metadata storage
- Tower CSV import
- Map folder selection and scanning
- Offline map data inventory

The project is being developed in stages toward a standalone offline Pakistan GIS/Map Data Manager. Electron packaging will be added only after the web application and offline map engine are stable.
