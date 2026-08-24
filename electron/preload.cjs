const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTileServerUrl: () => ipcRenderer.invoke('tile-server:get-url'),
  selectOfflineFolder: () => ipcRenderer.invoke('offline:select-folder'),
  selectSatelliteFolder: () => ipcRenderer.invoke('satellite:select-folder'),
  selectTerrainFolder: () => ipcRenderer.invoke('terrain:select-folder'),
  getOfflineFolder: () => ipcRenderer.invoke('offline:get-folder'),
  getSatelliteFolder: () => ipcRenderer.invoke('satellite:get-folder'),
  getTerrainFolder: () => ipcRenderer.invoke('terrain:get-folder'),
  scanOfflineFolder: () => ipcRenderer.invoke('offline:scan'),
  scanSatelliteFolder: () => ipcRenderer.invoke('satellite:scan'),
  scanTerrainFolder: () => ipcRenderer.invoke('terrain:scan'),
  downloadTiles: (options) => ipcRenderer.invoke('download:tiles', options),
  onDownloadProgress: (callback) => ipcRenderer.on('download:progress', (_event, progress) => callback(progress)),
  onTileServerReady: (callback) => ipcRenderer.on('tile-server-ready', (_event, port) => callback(port))
});
