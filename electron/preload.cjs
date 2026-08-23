const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTileServerUrl: () => ipcRenderer.invoke('tile-server:get-url'),
  selectOfflineFolder: () => ipcRenderer.invoke('offline:select-folder'),
  getOfflineFolder: () => ipcRenderer.invoke('offline:get-folder'),
  scanOfflineFolder: () => ipcRenderer.invoke('offline:scan'),
  onTileServerReady: (callback) => ipcRenderer.on('tile-server-ready', (_event, port) => callback(port))
});
