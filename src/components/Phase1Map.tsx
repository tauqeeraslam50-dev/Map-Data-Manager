import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Download, FolderOpen, Layers3, MapPinned, Navigation, RefreshCw, Search, Satellite, Mountain } from 'lucide-react';
import { formatCoordinate, parseCoordinateText, type Coordinate } from '../map/coordinates';
import { searchOffline, searchOnline, type MapSearchResult } from '../map/searchService';

interface ScanResult { files:number; tiles:number; zooms:number[]; root:string|null; bounds:{minLat:number;minLng:number;maxLat:number;maxLng:number}|null; }
interface DownloadProgress { done:number; total:number; downloaded:number; }
interface ElectronAPI {
  selectOfflineFolder:()=>Promise<{path:string;tileUrl:string}|null>;
  selectSatelliteFolder:()=>Promise<{path:string;tileUrl:string}|null>;
  selectTerrainFolder:()=>Promise<{path:string;tileUrl:string}|null>;
  scanOfflineFolder:()=>Promise<ScanResult>;
  scanSatelliteFolder:()=>Promise<ScanResult>;
  scanTerrainFolder:()=>Promise<ScanResult>;
  getTileServerUrl:()=>Promise<string>;
  downloadTiles:(options:any)=>Promise<{done:number;total:number;downloaded:number;destination:string}>;
  onDownloadProgress:(callback:(progress:DownloadProgress)=>void)=>void;
}
declare global { interface Window { electronAPI?: ElectronAPI } }

type Mode = 'online' | 'offline';
type BaseLayer = 'streets' | 'satellite';
type TerrainLayer = 'none' | 'terrain';

const PAKISTAN = { minLat:23.5, maxLat:37.1, minLng:60.8, maxLng:77.1 };
const ONLINE_STREETS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ONLINE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ONLINE_TERRAIN = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';

export default function Phase1Map() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.Layer | null>(null);
  const terrainRef = useRef<L.Layer | null>(null);
  const resultMarkerRef = useRef<L.CircleMarker | null>(null);
  const resultHighlightRef = useRef<L.Circle | null>(null);
  const [mode, setMode] = useState<Mode>('offline');
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('streets');
  const [terrainLayer, setTerrainLayer] = useState<TerrainLayer>('none');
  const [folder, setFolder] = useState('');
  const [satelliteFolder, setSatelliteFolder] = useState('');
  const [terrainFolder, setTerrainFolder] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [satelliteScan, setSatelliteScan] = useState<ScanResult | null>(null);
  const [terrainScan, setTerrainScan] = useState<ScanResult | null>(null);
  const [server, setServer] = useState('');
  const [scheme, setScheme] = useState<'xyz'|'tms'>('xyz');
  const [status, setStatus] = useState('Select an offline map folder');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<Mode>('offline');
  const [results, setResults] = useState<MapSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [coordinateText, setCoordinateText] = useState('30.375300, 69.345100');
  const [mouseCoordinate, setMouseCoordinate] = useState<Coordinate | null>(null);
  const [selectedResult, setSelectedResult] = useState<MapSearchResult | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadZoom, setDownloadZoom] = useState(8);
  const [downloadMaxZoom, setDownloadMaxZoom] = useState(10);
  const [downloadArea, setDownloadArea] = useState<'view'|'pakistan'>('view');
  const [downloadSource, setDownloadSource] = useState<'streets'|'satellite'|'terrain'>('satellite');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      zoomControl: true,
      preferCanvas: true,
      worldCopyJump: false,
      maxZoom: 19,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      updateWhenIdle: true,
      keepBuffer: 2
    }).setView([30.3753, 69.3451], 5);
    L.control.scale({ imperial: false }).addTo(map);
    map.on('mousemove', (event: L.LeafletMouseEvent) => setMouseCoordinate({ lat: event.latlng.lat, lon: event.latlng.lng }));
    map.on('mouseout', () => setMouseCoordinate(null));
    mapRef.current = map;
    window.electronAPI?.getTileServerUrl().then(setServer).catch(() => {});
    window.electronAPI?.onDownloadProgress(setDownloadProgress);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseRef.current) { map.removeLayer(baseRef.current); baseRef.current = null; }
    let layer: L.TileLayer;
    if (mode === 'online') {
      const url = baseLayer === 'satellite' ? ONLINE_SATELLITE : ONLINE_STREETS;
      layer = L.tileLayer(url, { maxZoom: 19, maxNativeZoom: 19, keepBuffer: 2, updateWhenIdle: true, attribution: baseLayer === 'satellite' ? 'Tiles © Esri' : '© OpenStreetMap contributors' });
      layer.addTo(map); baseRef.current = layer;
      setStatus(baseLayer === 'satellite' ? 'Online satellite imagery ready' : 'Online street map ready');
      return;
    }
    if (baseLayer === 'satellite') {
      if (!server || !satelliteScan?.tiles) { setStatus('Select an offline satellite tile folder'); return; }
      layer = L.tileLayer(`${server}/satellite/{z}/{x}/{y}.png`, { minZoom: Math.min(...satelliteScan.zooms), maxZoom: Math.max(...satelliteScan.zooms), maxNativeZoom: Math.max(...satelliteScan.zooms), tileSize: 256, noWrap: true, keepBuffer: 2, updateWhenIdle: true, tms: scheme === 'tms', attribution: 'Offline satellite imagery' });
      layer.addTo(map); baseRef.current = layer;
      setStatus(`${satelliteScan.tiles.toLocaleString()} offline satellite tiles • Zoom ${satelliteScan.zooms.join(', ')}`);
      return;
    }
    if (!server || !scan?.tiles || !scan.zooms.length) { setStatus('Select an offline map folder'); return; }
    layer = L.tileLayer(`${server}/tiles/{z}/{x}/{y}.png`, { minZoom: Math.min(...scan.zooms), maxZoom: Math.max(...scan.zooms), maxNativeZoom: Math.max(...scan.zooms), tileSize: 256, noWrap: true, keepBuffer: 2, updateWhenIdle: true, tms: scheme === 'tms', attribution: 'Offline raster map' });
    layer.addTo(map); baseRef.current = layer;
    if (scan.bounds) {
      const bounds = L.latLngBounds([scan.bounds.minLat, scan.bounds.minLng], [scan.bounds.maxLat, scan.bounds.maxLng]);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: Math.max(...scan.zooms) });
    }
    setStatus(`${scan.tiles.toLocaleString()} offline map tiles • Zoom ${scan.zooms.join(', ')}`);
  }, [mode, baseLayer, server, scan, satelliteScan, scheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (terrainRef.current) { map.removeLayer(terrainRef.current); terrainRef.current = null; }
    if (terrainLayer === 'none') return;
    let layer: L.TileLayer;
    if (mode === 'online') {
      layer = L.tileLayer(ONLINE_TERRAIN, { maxZoom: 17, maxNativeZoom: 17, opacity: 0.48, keepBuffer: 2, updateWhenIdle: true, attribution: '© OpenTopoMap contributors' });
    } else {
      if (!server || !terrainScan?.tiles) return;
      layer = L.tileLayer(`${server}/terrain/{z}/{x}/{y}.png`, { minZoom: Math.min(...terrainScan.zooms), maxZoom: Math.max(...terrainScan.zooms), opacity: 0.48, tileSize: 256, noWrap: true, keepBuffer: 2, updateWhenIdle: true, tms: scheme === 'tms', attribution: 'Offline terrain tiles' });
    }
    layer.addTo(map); terrainRef.current = layer;
  }, [mode, terrainLayer, server, terrainScan, scheme]);

  const scanFolder = async () => {
    if (!window.electronAPI) { setError('Run the Electron desktop application.'); return; }
    setError(''); setStatus('Scanning map folder...');
    try { const value = await window.electronAPI.scanOfflineFolder(); setScan(value); setStatus(value.tiles ? `${value.tiles.toLocaleString()} base tiles ready` : 'No raster tiles found'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('Scan failed'); }
  };

  const selectFolder = async () => {
    if (!window.electronAPI) { setError('Run the Electron desktop application.'); return; }
    try {
      const selected = await window.electronAPI.selectOfflineFolder(); if (!selected) return;
      setFolder(selected.path); setMode('offline'); setTimeout(scanFolder, 100);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const selectSatellite = async () => {
    if (!window.electronAPI) return setError('Run the Electron desktop application.');
    try {
      const selected = await window.electronAPI.selectSatelliteFolder(); if (!selected) return;
      setSatelliteFolder(selected.path); setMode('offline');
      const value = await window.electronAPI.scanSatelliteFolder(); setSatelliteScan(value);
      setBaseLayer('satellite');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const selectTerrain = async () => {
    if (!window.electronAPI) return setError('Run the Electron desktop application.');
    try {
      const selected = await window.electronAPI.selectTerrainFolder(); if (!selected) return;
      setTerrainFolder(selected.path); setMode('offline');
      const value = await window.electronAPI.scanTerrainFolder(); setTerrainScan(value);
      setTerrainLayer('terrain');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const clearResult = () => {
    const map = mapRef.current;
    if (map && resultMarkerRef.current) map.removeLayer(resultMarkerRef.current);
    if (map && resultHighlightRef.current) map.removeLayer(resultHighlightRef.current);
    resultMarkerRef.current = null; resultHighlightRef.current = null; setSelectedResult(null);
  };

  const showResult = (result: MapSearchResult) => {
    const map = mapRef.current; if (!map) return;
    clearResult();
    const latLng = L.latLng(result.lat, result.lon);
    map.setView(latLng, Math.max(map.getZoom(), 10), { animate: true });
    const marker = L.circleMarker(latLng, { radius: 9, color: '#fff', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
    marker.bindTooltip(result.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'phase1-result-label' }).openTooltip();
    const highlight = L.circle(latLng, { radius: 1800, color: '#ef4444', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.18, interactive: false }).addTo(map);
    resultMarkerRef.current = marker; resultHighlightRef.current = highlight; setSelectedResult(result);
    setCoordinateText(formatCoordinate({ lat: result.lat, lon: result.lon }));
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setError(''); setSearching(true); setResults([]);
    try {
      const found = searchMode === 'offline' ? searchOffline(query) : await searchOnline(query);
      setResults(found);
      if (!found.length) setError(searchMode === 'offline' ? 'No matching place in the offline place database.' : 'No online result found.');
      else showResult(found[0]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSearching(false); }
  };

  const goToCoordinate = () => {
    const coordinate = parseCoordinateText(coordinateText);
    if (!coordinate || !mapRef.current) { setError('Enter coordinates as: latitude, longitude'); return; }
    setError(''); clearResult();
    mapRef.current.setView([coordinate.lat, coordinate.lon], Math.max(mapRef.current.getZoom(), 12), { animate: true });
    const marker = L.circleMarker([coordinate.lat, coordinate.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapRef.current);
    marker.bindTooltip('Go-to coordinate', { permanent: true, direction: 'top' }).openTooltip(); resultMarkerRef.current = marker;
  };

  const startDownload = async () => {
    const map = mapRef.current; if (!map || !window.electronAPI) return;
    const bounds = downloadArea === 'pakistan' ? PAKISTAN : map.getBounds().toBBoxString();
    const b = downloadArea === 'pakistan' ? PAKISTAN : (() => { const x = map.getBounds(); return { minLat:x.getSouth(), maxLat:x.getNorth(), minLng:x.getWest(), maxLng:x.getEast() }; })();
    const destinationHint = downloadSource === 'satellite' ? 'satellite' : downloadSource === 'terrain' ? 'terrain' : 'maps';
    setError(''); setDownloading(true); setDownloadProgress(null);
    try {
      const result = await window.electronAPI.downloadTiles({
        template: downloadSource === 'satellite' ? ONLINE_SATELLITE : downloadSource === 'terrain' ? ONLINE_TERRAIN.replace('{s}', 'a') : ONLINE_STREETS,
        bounds: b,
        minZoom: downloadZoom,
        maxZoom: downloadMaxZoom,
        destination: `${await window.electronAPI.getOfflineFolder() || ''}`
      });
      setStatus(`Downloaded ${result.downloaded.toLocaleString()} ${destinationHint} tiles`);
      setDownloadOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setDownloading(false); }
  };

  return <div className="w-full h-full min-h-0 bg-slate-200 rounded-xl overflow-hidden border border-slate-300 shadow-inner relative flex flex-col">
    <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-2">
            <MapPinned className="w-4 h-4 text-green-600"/><span className="text-xs font-bold uppercase tracking-wider">Map</span>
            <button onClick={()=>setMode('offline')} className={`text-xs px-3 py-1.5 rounded-md font-semibold ${mode==='offline'?'bg-green-600 text-white':'bg-slate-100 text-slate-700'}`}>Offline</button>
            <button onClick={()=>setMode('online')} className={`text-xs px-3 py-1.5 rounded-md font-semibold ${mode==='online'?'bg-blue-600 text-white':'bg-slate-100 text-slate-700'}`}>Online</button>
            <button onClick={()=>setBaseLayer('streets')} className={`text-xs px-2.5 py-1.5 rounded-md ${baseLayer==='streets'?'bg-slate-800 text-white':'bg-slate-100'}`}>Streets</button>
            <button onClick={()=>setBaseLayer('satellite')} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md ${baseLayer==='satellite'?'bg-slate-800 text-white':'bg-slate-100'}`}><Satellite className="w-3.5 h-3.5"/>Satellite</button>
            <button onClick={()=>setTerrainLayer(v=>v==='none'?'terrain':'none')} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md ${terrainLayer==='terrain'?'bg-amber-600 text-white':'bg-slate-100'}`}><Mountain className="w-3.5 h-3.5"/>Terrain</button>
            <button onClick={selectFolder} className="flex items-center gap-1 bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-md"><FolderOpen className="w-3.5 h-3.5"/>Base Folder</button>
            <button onClick={selectSatellite} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-md">Satellite Folder</button>
            <button onClick={selectTerrain} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-md">Terrain Folder</button>
            <button onClick={()=>setDownloadOpen(v=>!v)} className="flex items-center gap-1 bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-md"><Download className="w-3.5 h-3.5"/>Download</button>
            <select value={scheme} onChange={e=>setScheme(e.target.value as 'xyz'|'tms')} className="text-xs border rounded-md px-2 py-1.5 bg-white"><option value="xyz">XYZ</option><option value="tms">TMS</option></select>
          </div>
          {downloadOpen && <div className="mt-2 border-t pt-2 flex flex-wrap items-center gap-2 text-xs">
            <select value={downloadSource} onChange={e=>setDownloadSource(e.target.value as any)} className="border rounded px-2 py-1.5"><option value="satellite">Satellite imagery</option><option value="streets">Street map</option><option value="terrain">Terrain</option></select>
            <select value={downloadArea} onChange={e=>setDownloadArea(e.target.value as any)} className="border rounded px-2 py-1.5"><option value="view">Current view</option><option value="pakistan">Pakistan extent</option></select>
            <label>From <input type="number" min="0" max="19" value={downloadZoom} onChange={e=>setDownloadZoom(Number(e.target.value))} className="w-12 border rounded px-1 py-1"/></label>
            <label>To <input type="number" min="0" max="19" value={downloadMaxZoom} onChange={e=>setDownloadMaxZoom(Number(e.target.value))} className="w-12 border rounded px-1 py-1"/></label>
            <button disabled={downloading} onClick={()=>void startDownload()} className="bg-indigo-600 text-white px-3 py-1.5 rounded font-semibold disabled:opacity-50">{downloading ? 'Downloading…' : 'Start download'}</button>
            {downloadProgress && <span>{downloadProgress.done.toLocaleString()} / {downloadProgress.total.toLocaleString()} ({downloadProgress.downloaded.toLocaleString()} new)</span>}
          </div>}
        </div>
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-2">
            <select value={searchMode} onChange={e=>setSearchMode(e.target.value as Mode)} className="text-xs border rounded-md px-2 py-1.5 bg-white"><option value="offline">Offline Search</option><option value="online">Online Search</option></select>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch();}} placeholder="Search city, village or place..." className="w-52 text-xs border rounded-md px-2.5 py-1.5"/>
            <button onClick={()=>void runSearch()} disabled={searching} className="flex items-center gap-1.5 bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-md"><Search className="w-3.5 h-3.5"/>{searching?'Searching':'Search'}</button>
          </div>
          {results.length>1 && <div className="mt-2 max-h-36 overflow-auto border-t pt-1 space-y-1">{results.map((r,i)=><button key={`${r.lat}-${r.lon}-${i}`} onClick={()=>showResult(r)} className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-100 truncate">{r.name}</button>)}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto flex items-center gap-2"><Navigation className="w-3.5 h-3.5 text-blue-600"/><input value={coordinateText} onChange={e=>setCoordinateText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')goToCoordinate();}} className="w-40 text-xs border rounded-md px-2 py-1.5 font-mono"/><button onClick={goToCoordinate} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md font-semibold">Go</button></div>
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg px-3 py-2 text-[10px] text-slate-600 pointer-events-auto"><div className="font-semibold text-green-700">{status}</div><div>Mouse: {mouseCoordinate?formatCoordinate(mouseCoordinate):'move cursor over map'}</div>{selectedResult&&<div className="text-red-700 font-semibold truncate max-w-[420px]">Selected: {selectedResult.name}</div>}</div>
      </div>
      {error&&<div className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-auto">{error}</div>}
    </div>
    <div ref={mapEl} className="flex-1 w-full min-h-0"/>
    <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 rounded-md shadow border px-2 py-1 text-[10px] text-slate-600 pointer-events-none flex items-center gap-1"><Layers3 className="w-3 h-3"/>{mode==='online'?'Online':'Offline'} • {baseLayer==='satellite'?'Satellite':'Street'} {terrainLayer==='terrain'?'• Terrain':''}</div>
  </div>;
}
