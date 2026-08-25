import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DEFAULT_CENTER: [number, number] = [69.3451, 30.3753];
const ONLINE_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

type ScanResult = {
  files: number;
  tiles: number;
  zooms: number[];
  root: string | null;
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
};

export default function OfflineMapViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [folder, setFolder] = useState<string>('');
  const [status, setStatus] = useState('Select an offline map folder');
  const [error, setError] = useState<string>('');
  const [mode, setMode] = useState<'offline' | 'online'>('offline');
  const [serverUrl, setServerUrl] = useState('');

  const fitBounds = useCallback((bounds: ScanResult['bounds']) => {
    if (!mapRef.current || !bounds) return;
    const sw: [number, number] = [bounds.minLng, bounds.minLat];
    const ne: [number, number] = [bounds.maxLng, bounds.maxLat];
    mapRef.current.fitBounds([sw, ne], { padding: 60, duration: 500, maxZoom: 16 });
  }, []);

  const setRasterSource = useCallback(async (nextMode: 'offline' | 'online', result?: ScanResult) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const sourceId = 'offline-region-raster';
    const layerId = 'offline-region-layer';
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    let tiles = ONLINE_TILES;
    if (nextMode === 'offline') {
      const api = window.electronAPI;
      if (!api?.getTileServerUrl) {
        throw new Error('Electron local tile server is not available. Start the desktop app with npm run electron:dev.');
      }
      const base = await api.getTileServerUrl();
      if (!base) throw new Error('Local tile server did not return an address.');
      setServerUrl(base);
      tiles = `${base}/tiles/{z}/{x}/{y}.png`;
    }

    map.addSource(sourceId, {
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 22,
      attribution: nextMode === 'online' ? '© OpenStreetMap contributors' : 'Local offline map data'
    });
    map.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 1 } });
    setMode(nextMode);
    if (nextMode === 'offline') fitBounds(result?.bounds || scan?.bounds || null);
  }, [fitBounds, scan?.bounds]);

  const scanSelectedFolder = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.scanOfflineFolder) throw new Error('Electron folder scanner is unavailable.');
    const result = await api.scanOfflineFolder();
    setScan(result);
    setFolder(result.root || '');
    if (!result.tiles) throw new Error('No XYZ raster tiles were found. Expected folders such as 5/17/12.png.');
    localStorage.setItem('rf-offline-region', JSON.stringify(result));
    setStatus(`${result.tiles.toLocaleString()} tiles registered • Zoom ${result.zooms.join(', ')}`);
    return result;
  }, []);

  const selectFolder = useCallback(async () => {
    setError('');
    try {
      const api = window.electronAPI;
      if (!api?.selectOfflineFolder) throw new Error('Folder selection requires the Electron desktop application.');
      const selected = await api.selectOfflineFolder();
      if (!selected) return;
      setFolder(selected.path);
      setStatus('Scanning offline region…');
      const result = await scanSelectedFolder();
      await setRasterSource('offline', result);
      requestAnimationFrame(() => mapRef.current?.resize());
      fitBounds(result.bounds);
      setStatus(`${result.tiles.toLocaleString()} tiles ready • Offline region active`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus('Offline region could not be loaded');
    }
  }, [fitBounds, scanSelectedFolder, setRasterSource]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e2e8f0' } }]
      },
      center: DEFAULT_CENTER,
      zoom: 5
    });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.on('error', event => {
      const message = event?.error?.message || 'Map rendering error';
      console.error('Offline map error:', event?.error || event);
      setError(String(message));
    });
    map.on('load', async () => {
      mapRef.current = map;
      try {
        const saved = localStorage.getItem('rf-offline-region');
        if (saved) {
          const previous: ScanResult = JSON.parse(saved);
          setScan(previous);
          if (previous.root) setFolder(previous.root);
        }
        const api = window.electronAPI;
        if (api?.getTileServerUrl) {
          const base = await api.getTileServerUrl();
          setServerUrl(base);
        }
      } catch (e) {
        console.warn('Could not restore offline region metadata', e);
      }
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !scan) return;
    if (folder) setRasterSource('offline', scan).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [folder, scan, setRasterSource]);

  return (
    <div className="w-full h-full min-h-0 bg-slate-300 rounded-xl overflow-hidden shadow-inner relative border-4 border-white">
      <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur rounded-lg shadow-lg border border-slate-200 p-3 w-[430px] max-w-[calc(100%-2rem)]">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Offline Map View</h2>
            <p className="text-[10px] text-slate-500 mt-1">Local tile region • no internet required</p>
          </div>
          <span className="text-[9px] font-bold px-2 py-1 rounded bg-green-100 text-green-700">{mode.toUpperCase()}</span>
        </div>
        <div className="flex gap-2 mb-2">
          <button onClick={selectFolder} className="flex-1 px-3 py-2 rounded bg-green-600 text-white text-[11px] font-bold hover:bg-green-700">SELECT OFFLINE MAP FOLDER</button>
          <button onClick={() => setRasterSource('online')} className="px-3 py-2 rounded bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700">ONLINE TEST</button>
        </div>
        <div className="text-[10px] text-slate-600 truncate" title={folder}>{folder || 'No folder selected'}</div>
        <div className="text-[10px] text-slate-500 mt-1">{status}</div>
        {scan?.bounds && <div className="text-[9px] text-slate-400 mt-1 font-mono">Bounds: {scan.bounds.minLat.toFixed(4)}, {scan.bounds.minLng.toFixed(4)} → {scan.bounds.maxLat.toFixed(4)}, {scan.bounds.maxLng.toFixed(4)}</div>}
        {serverUrl && <div className="text-[9px] text-slate-400 mt-1 font-mono truncate">Tile server: {serverUrl}</div>}
        {error && <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700"><strong>Offline map error:</strong> {error}</div>}
      </div>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
