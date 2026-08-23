import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Tower {
  id: string;
  name: string;
  lat: number;
  lng: number;
  height: number;
}

export interface MapPackage {
  id: string;
  name: string;
  file: File;
  size: number;
  tileType: number;
  enabled: boolean;
  minZoom: number;
  maxZoom: number;
  /** Vector source-layer IDs discovered from PMTiles metadata. */
  vectorLayers?: string[];
  /** PMTiles geographic bounds: [minLon, minLat, maxLon, maxLat]. */
  bounds?: [number, number, number, number];
}

interface RFDatabase extends DBSchema {
  towers: {
    key: string;
    value: Tower;
  };
  mapPackages: {
    key: string;
    value: MapPackage;
  };
  settings: {
    key: string;
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<RFDatabase>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<RFDatabase>('rf-offline-manager', 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('towers', { keyPath: 'id' });
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('mapPackages', { keyPath: 'id' });
          if (db.objectStoreNames.contains('tiles' as any)) {
            db.deleteObjectStore('tiles' as any);
          }
        }
        // Versions 3 and 4 only add metadata fields to MapPackage.
        // No object-store migration is required.
      },
    });
  }
  return dbPromise;
}

export async function saveMapPackage(pkg: MapPackage) {
  const db = await getDB();
  await db.put('mapPackages', pkg);
}

export async function getMapPackages(): Promise<MapPackage[]> {
  const db = await getDB();
  return db.getAll('mapPackages');
}

export async function deleteMapPackage(id: string) {
  const db = await getDB();
  await db.delete('mapPackages', id);
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(id);
  } catch (e) {
    // Ignore if not in OPFS
  }
}

export async function clearMapPackages() {
  const db = await getDB();
  const pkgs = await db.getAll('mapPackages');
  await db.clear('mapPackages');
  try {
    const root = await navigator.storage.getDirectory();
    for (const pkg of pkgs) {
      try {
        await root.removeEntry(pkg.id);
      } catch (e) {
        // Ignore
      }
    }
  } catch (e) {
    // Ignore
  }
}

export async function saveTower(tower: Tower) {
  const db = await getDB();
  await db.put('towers', tower);
}

export async function saveTowers(towers: Tower[]) {
  const db = await getDB();
  const tx = db.transaction('towers', 'readwrite');
  const store = tx.objectStore('towers');
  for (const tower of towers) {
    void store.put(tower);
  }
  await tx.done;
}

export async function getTowers(): Promise<Tower[]> {
  const db = await getDB();
  return db.getAll('towers');
}

export async function deleteTower(id: string) {
  const db = await getDB();
  await db.delete('towers', id);
}

export async function clearTowers() {
  const db = await getDB();
  await db.clear('towers');
}
