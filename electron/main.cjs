const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let mainWindow;
let server;
let offlineRoot = null;
let serverPort = 0;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function safeTilePath(root, z, x, y) {
  if (![z, x, y].every(v => /^\d+$/.test(v))) return null;
  const nZ = Number(z), nX = Number(x), nY = Number(y);
  if (nZ < 0 || nZ > 30 || nX < 0 || nY < 0) return null;
  const base = path.resolve(root);
  const candidates = [
    path.resolve(base, String(nZ), String(nX), `${nY}.png`),
    path.resolve(base, String(nZ), String(nX), `${nY}.jpg`),
    path.resolve(base, String(nZ), String(nX), `${nY}.jpeg`),
    path.resolve(base, String(nZ), String(nX), `${nY}.webp`)
  ];
  return candidates.find(p => p.startsWith(base + path.sep) && fs.existsSync(p)) || null;
}

function startTileServer() {
  server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || '');
    if (parsed.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, root: offlineRoot, port: serverPort }));
    }
    const match = parsed.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
    if (!match || !offlineRoot) {
      res.writeHead(404); return res.end('Tile not found');
    }
    const file = safeTilePath(offlineRoot, match[1], match[2], match[3]);
    if (!file) { res.writeHead(404); return res.end('Tile not found'); }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'public, max-age=86400' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    if (mainWindow) mainWindow.webContents.send('tile-server-ready', serverPort);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  mainWindow.loadURL(devUrl);
  if (process.env.ELECTRON_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

ipcMain.handle('tile-server:get-url', () => `http://127.0.0.1:${serverPort}`);
ipcMain.handle('offline:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  offlineRoot = result.filePaths[0];
  return { path: offlineRoot, tileUrl: `http://127.0.0.1:${serverPort}/tiles/{z}/{x}/{y}.png` };
});
ipcMain.handle('offline:get-folder', () => offlineRoot);
ipcMain.handle('offline:scan', async () => {
  if (!offlineRoot) return { files: 0, tiles: 0, zooms: [], root: null };
  let files = 0, tiles = 0; const zooms = new Set();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else {
        files++;
        const rel = path.relative(offlineRoot, full).replaceAll(path.sep, '/');
        const m = rel.match(/^(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
        if (m) { tiles++; zooms.add(Number(m[1])); }
      }
    }
  };
  walk(offlineRoot);
  return { files, tiles, zooms: [...zooms].sort((a,b) => a-b), root: offlineRoot };
});

app.whenReady().then(() => { startTileServer(); createWindow(); });
app.on('window-all-closed', () => { if (server) server.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
