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
let tls = null;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function headers(res, status, extra = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
    ...extra,
  });
}

function safeTilePath(root, z, x, y, ext) {
  if (![z, x, y].every(v => /^\d+$/.test(v))) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, z, x, `${y}.${ext.toLowerCase()}`);
  if (!file.startsWith(base + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

function makeCertificate() {
  const certDir = path.join(app.getPath('userData'), 'tls');
  fs.mkdirSync(certDir, { recursive: true });
  const keyFile = path.join(certDir, 'localhost-key.pem');
  const certFile = path.join(certDir, 'localhost-cert.pem');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 825,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
      ] }
    ]
  });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
}

function startTileServer() {
  tls = makeCertificate();
  server = https.createServer(tls, (req, res) => {
    const parsed = url.parse(req.url || '');
    if (req.method === 'OPTIONS') {
      headers(res, 204);
      return res.end();
    }
    if (parsed.pathname === '/health') {
      headers(res, 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, root: offlineRoot, port: serverPort, protocol: 'https' }));
    }

    // IMPORTANT: this regex is a JavaScript RegExp literal. Do not double-escape the slashes.
    const match = parsed.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
    if (!match || !offlineRoot) {
      headers(res, 404, { 'Content-Type': 'text/plain' });
      return res.end('Tile not found');
    }

    const file = safeTilePath(offlineRoot, match[1], match[2], match[3], match[4]);
    if (!file) {
      headers(res, 404, { 'Content-Type': 'text/plain' });
      return res.end('Tile not found');
    }

    headers(res, 200, { 'Content-Type': contentType(file), 'Cache-Control': 'public, max-age=86400' });
    fs.createReadStream(file).on('error', () => {
      if (!res.headersSent) headers(res, 500);
      res.end();
    }).pipe(res);
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === '127.0.0.1' || request.hostname === 'localhost') return callback(0);
    callback(-3);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  mainWindow.loadURL(devUrl);
}

ipcMain.handle('tile-server:get-url', () => `https://127.0.0.1:${serverPort}`);
ipcMain.handle('tile-server:test', async () => ({
  ok: !!serverPort,
  url: `https://127.0.0.1:${serverPort}`,
  root: offlineRoot
}));

ipcMain.handle('offline:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  offlineRoot = result.filePaths[0];
  return {
    path: offlineRoot,
    tileUrl: `https://127.0.0.1:${serverPort}/tiles/{z}/{x}/{y}.png`
  };
});

ipcMain.handle('offline:get-folder', () => offlineRoot);

ipcMain.handle('offline:scan', async () => {
  if (!offlineRoot) return { files: 0, tiles: 0, zooms: [], root: null, bounds: null };

  let files = 0;
  let tiles = 0;
  const zooms = new Set();
  let bounds = null;

  const tileBounds = (z, x, y) => {
    const n = 2 ** z;
    const minLng = x / n * 360 - 180;
    const maxLng = (x + 1) / n * 360 - 180;
    const lat = t => 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n)));
    const a = lat(y);
    const b = lat(y + 1);
    return { minLat: Math.min(a, b), maxLat: Math.max(a, b), minLng, maxLng };
  };

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files++;
        const rel = path.relative(offlineRoot, full).replaceAll(path.sep, '/');
        const m = rel.match(/^(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
        if (m) {
          const z = Number(m[1]);
          const x = Number(m[2]);
          const y = Number(m[3]);
          tiles++;
          zooms.add(z);
          const b = tileBounds(z, x, y);
          bounds = bounds
            ? {
                minLat: Math.min(bounds.minLat, b.minLat),
                maxLat: Math.max(bounds.maxLat, b.maxLat),
                minLng: Math.min(bounds.minLng, b.minLng),
                maxLng: Math.max(bounds.maxLng, b.maxLng)
              }
            : b;
        }
      }
    }
  };

  walk(offlineRoot);
  return {
    files,
    tiles,
    zooms: [...zooms].sort((a, b) => a - b),
    root: offlineRoot,
    bounds
  };
});

app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === '127.0.0.1' || request.hostname === 'localhost') callback(0);
    else callback(-3);
  });
  startTileServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
