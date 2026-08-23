import * as maplibregl from 'maplibre-gl';

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DB_NAME = 'rf-offline-map-cache';
const DB_VERSION = 1;
const STORE = 'tiles';

let protocolRegistered = false;

function openTileDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
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

export function tileKey(z: number, x: number, y: number) {
  return `${z}/${x}/${y}`;
}

function tileCount(minLat: number, minLng: number, maxLat: number, maxLng: number, zoom: number) {
  const n = 2 ** zoom;
  const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const y = (lat: number) => {
    const r = clampLat(lat) * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n);
  };
  const x1 = Math.max(0, Math.min(n - 1, x(Math.min(minLng, maxLng))));
  const x2 = Math.max(0, Math.min(n - 1, x(Math.max(minLng, maxLng))));
  const y1 = Math.max(0, Math.min(n - 1, y(Math.max(minLat, maxLat))));
  const y2 = Math.max(0, Math.min(n - 1, y(Math.min(minLat, maxLat))));
  return Math.max(0, x2 - x1 + 1) * Math.max(0, y2 - y1 + 1);
}

export function estimateDownload(minLat: number, minLng: number, maxLat: number, maxLng: number, minZoom: number, maxZoom: number) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) total += tileCount(minLat, minLng, maxLat, maxLng, z);
  return total;
}

function tileRange(minLat: number, minLng: number, maxLat: number, maxLng: number, zoom: number) {
  const n = 2 ** zoom;
  const clampLat = (lat: number) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const toX = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const toY = (lat: number) => {
    const r = clampLat(lat) * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n);
  };
  return {
    minX: Math.max(0, Math.min(n - 1, toX(Math.min(minLng, maxLng)))),
    maxX: Math.max(0, Math.min(n - 1, toX(Math.max(minLng, maxLng)))),
    minY: Math.max(0, Math.min(n - 1, toY(Math.max(minLat, maxLat)))),
    maxY: Math.max(0, Math.min(n - 1, toY(Math.min(minLat, maxLat))))
  };
}

export async function downloadTileRegion(
  template: string,
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  minZoom: number,
  maxZoom: number,
  onProgress?: (done: number, total: number) => void
) {
  const total = estimateDownload(minLat, minLng, maxLat, maxLng, minZoom, maxZoom);
  let done = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const range = tileRange(minLat, minLng, maxLat, maxLng, z);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const key = tileKey(z, x, y);
        try {
          const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
          const response = await fetch(url, { mode: 'cors' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          await putTile(key, blob);
        } catch (error) {
          console.warn('Tile download failed:', key, error);
        }
        done++;
        onProgress?.(done, total);
      }
    }
  }
  return { done, total };
}

export function registerOfflineProtocol() {
  if (protocolRegistered) return;
  maplibregl.addProtocol('offline', async (params: any, callback: any) => {
    try {
      const match = params.url.match(/^offline:\/\/tiles\/(\d+)\/(\d+)\/(\d+)/);
      if (!match) throw new Error('Invalid offline tile URL');
      const data = await getCachedTile(tileKey(Number(match[1]), Number(match[2]), Number(match[3])));
      if (!data) {
        callback(new Error('Tile is not cached'), null, null, null);
      } else {
        callback(null, data, null, null);
      }
    } catch (error) {
      callback(error, null, null, null);
    }
    return { cancel: () => undefined };
  });
  protocolRegistered = true;
}
