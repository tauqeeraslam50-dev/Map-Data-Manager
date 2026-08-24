import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, FolderOpen, MapPinned, Navigation, RefreshCw, Search } from 'lucide-react';
import { formatCoordinate, parseCoordinateText, type Coordinate } from '../map/coordinates';
import { searchOffline, searchOnline, type MapSearchResult } from '../map/searchService';

interface ScanResult { files:number; tiles:number; zooms:number[]; root:string|null; bounds:{minLat:number;minLng:number;maxLat:number;maxLng:number}|null; }
interface ElectronAPI { selectOfflineFolder:()=>Promise<{path:string;tileUrl:string}|null>; scanOfflineFolder:()=>Promise<ScanResult>; getTileServerUrl:()=>Promise<string>; }
declare global { interface Window { electronAPI?: ElectronAPI } }

type Mode = 'online' | 'offline';

export default function Phase1Map() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.Layer | null>(null);
  const resultMarkerRef = useRef<L.CircleMarker | null>(null);
  const resultHighlightRef = useRef<L.Circle | null>(null);
  const [mode, setMode] = useState<Mode>('offline');
  const [folder, setFolder] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
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

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, preferCanvas: true, worldCopyJump: false }).setView([30.3753, 69.3451], 5);
    L.control.scale({ imperial: false }).addTo(map);
    map.on('mousemove', (event: L.LeafletMouseEvent) => setMouseCoordinate({ lat: event.latlng.lat, lon: event.latlng.lng }));
    map.on('mouseout', () => setMouseCoordinate(null));
    mapRef.current = map;
    window.electronAPI?.getTileServerUrl().then(setServer).catch(() => {});
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    if (mode === 'online') {
      const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
      layer.addTo(map); layerRef.current = layer;
      setStatus('Online map ready');
      return;
    }
    if (!server || !scan?.tiles || !scan.zooms.length) { setStatus('Select an offline map folder'); return; }
    const layer = L.tileLayer(`${server}/tiles/{z}/{x}/{y}.png`, { minZoom: Math.min(...scan.zooms), maxZoom: Math.max(...scan.zooms), tileSize: 256, noWrap: true, keepBuffer: 2, tms: scheme === 'tms', attribution: 'Offline raster map' });
    layer.addTo(map); layerRef.current = layer;
    if (scan.bounds) {
      const bounds = L.latLngBounds([scan.bounds.minLat, scan.bounds.minLng], [scan.bounds.maxLat, scan.bounds.maxLng]);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: Math.max(...scan.zooms) });
    }
    setStatus(`${scan.tiles.toLocaleString()} tiles loaded • Zoom ${scan.zooms.join(', ')}`);
  }, [mode, server, scan, scheme]);

  const scanFolder = async () => {
    if (!window.electronAPI) { setError('Run the Electron desktop application.'); return; }
    setError(''); setStatus('Scanning map folder...');
    try { const value = await window.electronAPI.scanOfflineFolder(); setScan(value); setStatus(value.tiles ? `${value.tiles.toLocaleString()} tiles ready` : 'No raster tiles found'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus('Scan failed'); }
  };

  const selectFolder = async () => {
    if (!window.electronAPI) { setError('Run the Electron desktop application, not the browser preview.'); return; }
    setError('');
    try {
      const selected = await window.electronAPI.selectOfflineFolder();
      if (!selected) return;
      setFolder(selected.path);
      setServer(selected.tileUrl.replace('/tiles/{z}/{x}/{y}.png', ''));
      setMode('offline');
      setTimeout(scanFolder, 100);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const clearResult = () => {
    const map = mapRef.current;
    if (map && resultMarkerRef.current) map.removeLayer(resultMarkerRef.current);
    if (map && resultHighlightRef.current) map.removeLayer(resultHighlightRef.current);
    resultMarkerRef.current = null; resultHighlightRef.current = null; setSelectedResult(null);
  };

  const showResult = (result: MapSearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    clearResult();
    const latLng = L.latLng(result.lat, result.lon);
    map.setView(latLng, Math.max(map.getZoom(), 10), { animate: true });
    const marker = L.circleMarker(latLng, { radius: 9, color: '#ffffff', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
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
    mapRef.current.setView([coordinate.lat, coordinate.lon], Math.max(mapRef.current.getZoom(), 10), { animate: true });
    const marker = L.circleMarker([coordinate.lat, coordinate.lon], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapRef.current);
    marker.bindTooltip('Go-to coordinate', { permanent: true, direction: 'top' }).openTooltip();
    resultMarkerRef.current = marker;
  };

  return <div className="w-full h-full min-h-0 bg-slate-200 rounded-xl overflow-hidden border border-slate-300 shadow-inner relative flex flex-col">
    <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-2">
            <MapPinned className="w-4 h-4 text-green-600" />
            <span className="text-xs font-bold uppercase tracking-wider">Phase 1 Map Controls</span>
            <button onClick={() => setMode('offline')} className={`text-xs px-3 py-1.5 rounded-md font-semibold ${mode === 'offline' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Offline</button>
            <button onClick={() => setMode('online')} className={`text-xs px-3 py-1.5 rounded-md font-semibold ${mode === 'online' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>Online</button>
            <button onClick={selectFolder} className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md"><FolderOpen className="w-3.5 h-3.5"/>Map Folder</button>
            <button onClick={scanFolder} disabled={!folder} className="flex items-center gap-1.5 bg-slate-100 disabled:opacity-40 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-md"><RefreshCw className="w-3.5 h-3.5"/>Rescan</button>
            <select value={scheme} onChange={e=>setScheme(e.target.value as 'xyz'|'tms')} className="text-xs border rounded-md px-2 py-1.5 bg-white"><option value="xyz">XYZ</option><option value="tms">TMS</option></select>
          </div>
        </div>
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto">
          <div className="flex flex-wrap items-center gap-2">
            <select value={searchMode} onChange={e=>setSearchMode(e.target.value as Mode)} className="text-xs border rounded-md px-2 py-1.5 bg-white"><option value="offline">Offline Search</option><option value="online">Online Search</option></select>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch();}} placeholder="Search city or place..." className="w-52 text-xs border rounded-md px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-200" />
            <button onClick={() => void runSearch()} disabled={searching} className="flex items-center gap-1.5 bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-md"><Search className="w-3.5 h-3.5"/>{searching ? 'Searching' : 'Search'}</button>
          </div>
          {results.length > 1 && <div className="mt-2 max-h-36 overflow-auto border-t pt-1 space-y-1">{results.map((r,i)=><button key={`${r.lat}-${r.lon}-${i}`} onClick={()=>showResult(r)} className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-100 truncate">{r.name}</button>)}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg p-2 pointer-events-auto flex items-center gap-2">
          <Navigation className="w-3.5 h-3.5 text-blue-600" />
          <input value={coordinateText} onChange={e=>setCoordinateText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')goToCoordinate();}} className="w-40 text-xs border rounded-md px-2 py-1.5 font-mono" aria-label="Latitude longitude" />
          <button onClick={goToCoordinate} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md font-semibold">Go</button>
          <button onClick={()=>{const c=mapRef.current?.getCenter();if(c)setCoordinateText(formatCoordinate({lat:c.lat,lon:c.lng}));}} className="text-xs bg-slate-100 text-slate-700 px-2 py-1.5 rounded-md">Center</button>
        </div>
        <div className="bg-white/95 rounded-lg border border-slate-200 shadow-lg px-3 py-2 text-[10px] text-slate-600 pointer-events-auto">
          <div className="font-semibold text-green-700">{status}</div>
          <div>Mouse: {mouseCoordinate ? formatCoordinate(mouseCoordinate) : 'move cursor over map'}</div>
          {selectedResult && <div className="text-red-700 font-semibold truncate max-w-[420px]">Selected: {selectedResult.name}</div>}
        </div>
      </div>
      {error && <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-auto">{error}</div>}
    </div>
    <div ref={mapEl} className="flex-1 w-full min-h-0" />
    <div className="absolute bottom-3 right-3 z-[1000] bg-white/90 rounded-md shadow border px-2 py-1 text-[10px] text-slate-600 pointer-events-none flex items-center gap-1"><Crosshair className="w-3 h-3"/>Lat/Lon tracking active</div>
  </div>;
}
