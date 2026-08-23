import * as pmtiles from "pmtiles";
import * as maplibregl from "maplibre-gl";
import { getMapPackages, MapPackage, saveMapPackage } from "./db";

// Initialize protocol globally once
export const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

let currentPackages: MapPackage[] = [];
const listeners = new Set<() => void>();

export async function loadPackagesFromDb() {
  const pkgs = await getMapPackages();
  currentPackages = pkgs;
  
  // Register all enabled packages in the protocol
  currentPackages.forEach(pkg => {
    if (pkg.enabled) {
      const fileSource = new pmtiles.FileSource(pkg.file);
      const p = new pmtiles.PMTiles(fileSource);
      pmtilesProtocol.add(p);
    }
  });
  
  notifyListeners();
}

export function getActivePackages() {
  return currentPackages;
}

export async function addMapPackage(file: File) {
  try {
    const source = new pmtiles.FileSource(file);
    const p = new pmtiles.PMTiles(source);
    const header = await p.getHeader();
    
    const pkg: MapPackage = {
      id: Date.now().toString() + "-" + file.name,
      name: file.name,
      file: file,
      size: file.size,
      tileType: header.tileType,
      enabled: true,
      minZoom: header.minZoom,
      maxZoom: header.maxZoom
    };
    
    await saveMapPackage(pkg);
    await loadPackagesFromDb();
    return true;
  } catch (err) {
    console.error("Failed to add PMTiles package:", err);
    return false;
  }
}

export async function togglePackage(id: string, enabled: boolean) {
  const pkg = currentPackages.find(p => p.id === id);
  if (pkg) {
    pkg.enabled = enabled;
    await saveMapPackage(pkg);
    await loadPackagesFromDb();
  }
}

export function subscribePmtilesFile(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach(l => l());
}

// Kickoff initial load
loadPackagesFromDb();
