const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const https = require('https');
const selfsigned = require('selfsigned');
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

function sendHeaders(res, statusCode, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers,
  });
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

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const minLng = (x / n) * 360 - 180;
  const maxLng = ((x + 1) / n) * 360 - 180;
  const latFromY = tileY => 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
  const a = latFromY(y), b = latFromY(y + 1);
  return { minLat: Math.min(a, b), maxLat: Math.max(a, b), minLng, maxLng };
}

function createCertificate() {
  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'PakLink Map Data Manager' }
  ];
  return selfsigned.generate(attrs, {
    keySize: 2048,
    days: 825,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', keyUsages: ['digitalSignature', 'keyEncipherment'] },
      { name: 'extKeyUsage', usages: ['serverAuth'] },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
      ] }
    ]
  });
}

function startTileServer() {
  const cert = createCertificate();
  server = https.createServer({ key: cert.private, cert: cert.cert }, (req, res) => {
    const parsed = url.parse(req.url || '');
    if (req.method === 'OPTIONS') {
      sendHeaders(res, 204);
      return res.end();
    }
    if (parsed.pathname === '/health') {
      sendHeaders(res, 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, protocol: 'https', root: offlineRoot, port: serverPort }));
    }
    const match = parsed.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
    if (!match || !offlineRoot) {
      sendHeaders(res, 404, { 'Content-Type': 'text/plain' });
      return res.end('Tile not found');
    }
    const file = safeTilePath(offlineRoot, match[1], match[2], match[3]);
    if (!file) {
      sendHeaders(res, 404, { 'Content-Type': 'text/plain' });
      return res.end('Tile not found');
    }
    sendHeaders(res, 200, {
      'Content-Type': contentType(file),
      'Cache-Control': 'public, max-age=86400',
    });
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
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    const host = request.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1') return callback(0);
    callback(-3);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  mainWindow.loadURL(devUrl);
  if (process.env.ELECTRON_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

ipcMain.handle('tile-server:get-url', () => `https://127.0.0.1:${serverPort}`);
ipcMain.handle('tile-server:test', async () => {
  if (!serverPort) return { ok: false, error: 'HTTPS tile server is not ready' };
  return { ok: true, protocol: 'https', url: `https://127.0.0.1:${serverPort}`, root: offlineRoot };
});
ipcMain.handle('offline:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  offlineRoot = result.filePaths[0];
  return { path: offlineRoot, tileUrl: `https://127.0.0.1:${serverPort}/tiles/{z}/{x}/{y}.png` };
});
ipcMain.handle('offline:get-folder', () => offlineRoot);
ipcMain.handle('offline:scan', async () => {
  if (!offlineRoot) return { files: 0, tiles: 0, zooms: [], root: null, bounds: null };
  let files = 0, tiles = 0;
  const zooms = new Set();
  let bounds = null;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files++;
        const rel = path.relative(offlineRoot, full).replaceAll(path.sep, '/');
        const m = rel.match(/^(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
        if (m) {
          const z = Number(m[1]), x = Number(m[2]), y = Number(m[3]);
          tiles++;
          zooms.add(z);
          const b = tileBounds(z, x, y);
          bounds = bounds ? {
            minLat: Math.min(bounds.minLat, b.minLat), minLng: Math.min(bounds.minLng, b.minLng),
            maxLat: Math.max(bounds.maxLat, b.maxLat), maxLng: Math.max(bounds.maxLng, b.maxLng)
          } : b;
        }
      }
    }
  };
  walk(offlineRoot);
  return { files, tiles, zooms: [...zooms].sort((a,b) => a-b), root: offlineRoot, bounds };
});

app.whenReady().then(() => { startTileServer(); createWindow(); });
app.on('window-all-closed', () => { if (server) server.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
