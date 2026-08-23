import * as pmtiles from "pmtiles";
import * as maplibregl from "maplibre-gl";
import { getMapPackages, MapPackage, saveMapPackage } from "./db";

// Register the PMTiles protocol once for the whole application.
export const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

let currentPackages: MapPackage[] = [];
const listeners = new Set<() => void>();

function getVectorLayerIds(metadata: any): string[] {
  const layers = Array.isArray(metadata?.vector_layers) ? metadata.vector_layers : [];
  return layers
    .map((layer: any) => layer?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
}

class CustomFileSource implements pmtiles.Source {
  file: File;
  id: string;
  constructor(file: File, id: string) {
    this.file = file;
    this.id = id;
  }
  getKey() {
    return this.id;
  }
  async getBytes(offset: number, length: number) {
    const slice = this.file.slice(offset, offset + length);
    const buffer = await slice.arrayBuffer();
    return { data: buffer };
  }
}

async function preparePackage(pkg: MapPackage) {
  if (!pkg.file) return;

  try {
    const source = new CustomFileSource(pkg.file, pkg.id);
    const archive = new pmtiles.PMTiles(source);

    // Register the archive with the protocol so MapLibre can request tiles
    // through pmtiles://<pkg.id> without loading the whole archive into RAM.
    pmtilesProtocol.add(archive);

    // Read archive metadata once. This lets the renderer use the real
    // vector source-layer IDs instead of assuming a layer named "default".
    if (pkg.tileType === 1 && (!pkg.vectorLayers || pkg.vectorLayers.length === 0)) {
      const metadata = await archive.getMetadata();
      const vectorLayers = getVectorLayerIds(metadata);

      if (vectorLayers.length > 0) {
        pkg.vectorLayers = vectorLayers;
        await saveMapPackage(pkg);
      }
    }
  } catch (error) {
    console.error(`Failed to prepare PMTiles package ${pkg.name}:`, error);
  }
}

export async function loadPackagesFromDb() {
  const pkgs = await getMapPackages();
  
  let root: FileSystemDirectoryHandle | null = null;
  try {
    root = await navigator.storage.getDirectory();
  } catch (e) {
    console.warn("OPFS not available, relying on IDB blob storage.", e);
  }

  for (const pkg of pkgs) {
    if (root) {
      try {
        const handle = await root.getFileHandle(pkg.id);
        pkg.file = await handle.getFile();
      } catch (e) {
        console.warn(`File ${pkg.id} not found in OPFS, falling back to IDB blob.`);
      }
    }
  }

  currentPackages = pkgs;

  await Promise.all(
    currentPackages
      .filter(pkg => pkg.enabled)
      .map(pkg => preparePackage(pkg))
  );

  // Refresh after metadata discovery so the UI can display the real layers.
  currentPackages = await getMapPackages();
  notifyListeners();
}

export function getActivePackages() {
  return currentPackages;
}

export async function addMapPackage(file: File) {
  try {
    const tempId = "temp-" + Date.now();
    const source = new CustomFileSource(file, tempId);
    const archive = new pmtiles.PMTiles(source);
    const header = await archive.getHeader();

    let vectorLayers: string[] | undefined;
    if (header.tileType === 1) {
      const metadata = await archive.getMetadata();
      vectorLayers = getVectorLayerIds(metadata);
    }

    const safeId = Date.now().toString() + "-" + file.name.replace(/[^a-zA-Z0-9-]/g, '');

    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(safeId, { create: true });
      // Use createWritable if available, or fallback
      if ('createWritable' in handle) {
        const writable = await (handle as any).createWritable();
        await writable.write(file);
        await writable.close();
      }
    } catch (e) {
      console.warn("Failed to write to OPFS", e);
    }

    const pkg: MapPackage = {
      id: safeId,
      name: file.name,
      file,
      size: file.size,
      tileType: header.tileType,
      enabled: true,
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      vectorLayers
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

// Kick off the initial load without blocking application startup.
void loadPackagesFromDb();
