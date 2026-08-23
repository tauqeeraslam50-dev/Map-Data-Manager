import * as maplibregl from 'maplibre-gl';

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DB_NAME = 'rf-offline-map-cache';
const DB_VERSION = 1;
const STORE = 'tiles';
let protocolRegistered = false;
let selectedDirectory: FileSystemDirectoryHandle | null = null;
let selectedDirectoryName: string | null = null;

function openTileDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putTile(key: string, blob: Blob) {
  const db = await openTileDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function chooseDownloadDirectory(): Promise<string> {
  const picker = (window as any).showDirectoryPicker;
  if (typeof picker !== 'function') throw new Error('Folder selection is not supported here. Use Chrome/Edge desktop, or use Import Tile Folder below.');
  selectedDirectory = await picker({ mode: 'readwrite' });
  selectedDirectoryName = selectedDirectory?.name || null;
  return selectedDirectoryName || 'Selected folder';
}

export function getSelectedDirectoryName() { return selectedDirectoryName; }

async function saveTileToDirectory(z: number, x: number, y: number, blob: Blob) {
  if (!selectedDirectory) return;
  const zDir = await selectedDirectory.getDirectoryHandle(String(z), { create: true });
  const xDir = await zDir.getDirectoryHandle(String(x), { create: true });
  const fileHandle = await xDir.getFileHandle(`${y}.png`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function getCachedTile(key: string): Promise<ArrayBuffer | null> {
  const db = await openTileDB();
  const value = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ? value.arrayBuffer() : null;
}

export async function clearOfflineTiles() {
  const db = await openTileDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function tileKey(z: number, x: number, y: number) { return `${z}/${x}/${y}`; }

function tileRange(minLat: number, minLng: number, maxLat: number, maxLng: number, zoom: number) {
  const n = 2 ** zoom;
  const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const toX = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const toY = (lat: number) => { const r = clampLat(lat) * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n); };
  return { minX: Math.max(0, Math.min(n - 1, toX(Math.min(minLng, maxLng)))), maxX: Math.max(0, Math.min(n - 1, toX(Math.max(minLng, maxLng)))), minY: Math.max(0, Math.min(n - 1, toY(Math.max(minLat, maxLat)))), maxY: Math.max(0, Math.min(n - 1, toY(Math.min(minLat, maxLat)))) };
}

export function estimateDownload(minLat: number, minLng: number, maxLat: number, maxLng: number, minZoom: number, maxZoom: number) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) { const r = tileRange(minLat, minLng, maxLat, maxLng, z); total += Math.max(0, r.maxX - r.minX + 1) * Math.max(0, r.maxY - r.minY + 1); }
  return total;
}

export async function downloadTileRegion(template: string, minLat: number, minLng: number, maxLat: number, maxLng: number, minZoom: number, maxZoom: number, onProgress?: (done: number, total: number) => void) {
  const total = estimateDownload(minLat, minLng, maxLat, maxLng, minZoom, maxZoom);
  let done = 0;
  let savedToFolder = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const range = tileRange(minLat, minLng, maxLat, maxLng, z);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        try {
          const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
          const response = await fetch(url, { mode: 'cors' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          await putTile(tileKey(z, x, y), blob);
          if (selectedDirectory) { await saveTileToDirectory(z, x, y, blob); savedToFolder++; }
        } catch (error) { console.warn('Tile download failed:', `${z}/${x}/${y}`, error); }
        done++;
        onProgress?.(done, total);
      }
    }
  }
  return { done, total, savedToFolder, directory: selectedDirectoryName };
}

/** Import a normal XYZ tile folder containing z/x/y.png (or jpg/jpeg/webp) files. */
export async function importTileFolder(files: FileList | File[]): Promise<{ imported: number; skipped: number; zooms: number[] }> {
  const list = Array.from(files);
  let imported = 0;
  let skipped = 0;
  const zooms = new Set<number>();
  for (const file of list) {
    const relativePath = ((file as any).webkitRelativePath || file.name || '').replace(/\\/g, '/');
    const match = relativePath.match(/(?:^|\/)(\d+)\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i);
    if (!match) { skipped++; continue; }
    const z = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 30 || x < 0 || y < 0) { skipped++; continue; }
    await putTile(tileKey(z, x, y), file);
    zooms.add(z);
    imported++;
  }
  return { imported, skipped, zooms: Array.from(zooms).sort((a, b) => a - b) };
}

export function registerOfflineProtocol() {
  if (protocolRegistered) return;
  maplibregl.addProtocol('offline', async (params, abortController) => {
    const match = params.url.match(/^offline:\/\/tiles\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) throw new Error('Invalid offline tile URL');
    const data = await getCachedTile(tileKey(Number(match[1]), Number(match[2]), Number(match[3])));
    if (abortController.signal.aborted) throw new Error('Request aborted');
    if (!data) throw new Error('Tile is not cached');
    return { data };
  });
  protocolRegistered = true;
}
