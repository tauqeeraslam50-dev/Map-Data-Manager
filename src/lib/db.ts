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
    dbPromise = openDB<RFDatabase>('rf-offline-manager', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('towers', { keyPath: 'id' });
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('mapPackages', { keyPath: 'id' });
          // If we had 'tiles' store from old version, we could delete it, but let's just leave it or safely ignore.
          if (db.objectStoreNames.contains('tiles' as any)) {
            db.deleteObjectStore('tiles' as any);
          }
        }
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
}

export async function clearMapPackages() {
  const db = await getDB();
  await db.clear('mapPackages');
}

export async function saveTower(tower: Tower) {
  const db = await getDB();
  await db.put('towers', tower);
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
