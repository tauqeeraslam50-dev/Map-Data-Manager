import React, { useMemo, useState, useEffect } from 'react';
import { Download, Globe2, Trash2, MapPinned } from 'lucide-react';
import { DEFAULT_TILE_URL, clearOfflineTiles, downloadTileRegion, estimateDownload, registerOfflineProtocol } from '../lib/onlineMap';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const PAKISTAN = { minLat: 23.5, minLng: 60.8, maxLat: 37.2, maxLng: 77.2 };

function MapEvents({ onBoundsChange }: { onBoundsChange: (bounds: {minLat: number, minLng: number, maxLat: number, maxLng: number}) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBoundsChange({ minLat: b.getSouth(), minLng: b.getWest(), maxLat: b.getNorth(), maxLng: b.getEast() });
    },
    zoomend: () => {
      const b = map.getBounds();
      onBoundsChange({ minLat: b.getSouth(), minLng: b.getWest(), maxLat: b.getNorth(), maxLng: b.getEast() });
    }
  });

  useEffect(() => {
    const b = map.getBounds();
    onBoundsChange({ minLat: b.getSouth(), minLng: b.getWest(), maxLat: b.getNorth(), maxLng: b.getEast() });
  }, [map, onBoundsChange]);

  return null;
}

export default function OnlineMapManager() {
  const [template, setTemplate] = useState(DEFAULT_TILE_URL);
  const [minLat, setMinLat] = useState(PAKISTAN.minLat);
  const [minLng, setMinLng] = useState(PAKISTAN.minLng);
  const [maxLat, setMaxLat] = useState(PAKISTAN.maxLat);
  const [maxLng, setMaxLng] = useState(PAKISTAN.maxLng);
  const [minZoom, setMinZoom] = useState(5);
  const [maxZoom, setMaxZoom] = useState(8);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');

  const estimated = useMemo(() => estimateDownload(minLat, minLng, maxLat, maxLng, minZoom, maxZoom), [minLat, minLng, maxLat, maxLng, minZoom, maxZoom]);

  const download = async () => {
    if (!template.includes('{z}') || !template.includes('{x}') || !template.includes('{y}')) { setMessage('Tile URL must contain {z}, {x} and {y}.'); return; }
    if (minZoom > maxZoom) { setMessage('Minimum zoom cannot be greater than maximum zoom.'); return; }
    if (estimated > 10000) { setMessage(`This area/zoom selection contains ${estimated.toLocaleString()} tiles. Reduce the area or maximum zoom to 10,000 tiles or fewer.`); return; }
    registerOfflineProtocol();
    setDownloading(true);
    setProgress(0);
    setMessage('Downloading tiles into the local offline cache...');
    try {
      const result = await downloadTileRegion(template, minLat, minLng, maxLat, maxLng, minZoom, maxZoom, (done, total) => setProgress(Math.round((done / total) * 100)));
      localStorage.setItem('rf-map-mode', 'offline');
      window.dispatchEvent(new CustomEvent('rf-map-mode-changed', { detail: 'offline' }));
      setMessage(`Offline download complete: ${result.done.toLocaleString()} tile requests processed. Field Map is now set to OFFLINE mode.`);
    } catch (error) {
      setMessage(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setDownloading(false); }
  };

  const clear = async () => {
    await clearOfflineTiles();
    localStorage.setItem('rf-map-mode', 'online');
    window.dispatchEvent(new CustomEvent('rf-map-mode-changed', { detail: 'online' }));
    setMessage('Offline tile cache cleared. Field Map returned to ONLINE mode.');
  };

  return (
    <div className="w-full h-full bg-white rounded-xl overflow-y-auto shadow-inner border-4 border-white p-6 md:p-8 space-y-6 flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center"><Globe2 className="w-6 h-6 mr-3 text-blue-600" />Online Map Downloader</h2>
          <p className="text-sm text-slate-500 mt-1">Preview an online XYZ tile service and save a bounded area into the local offline cache.</p>
        </div>
        <MapPinned className="w-8 h-8 text-slate-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[400px]">
        
        {/* Left side: Interactive Map Preview */}
        <div className="lg:col-span-2 flex flex-col border rounded-lg overflow-hidden relative shadow-sm">
          <div className="bg-slate-100 px-3 py-2 border-b text-xs font-semibold text-slate-600 flex justify-between items-center">
            <span>Map Preview & Area Selection</span>
            <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded text-slate-500">Pan & Zoom to select bounds</span>
          </div>
          <div className="flex-1 w-full bg-slate-200 z-0 relative">
            <MapContainer 
              bounds={[[PAKISTAN.minLat, PAKISTAN.minLng], [PAKISTAN.maxLat, PAKISTAN.maxLng]]} 
              style={{ height: '100%', width: '100%', zIndex: 0 }}
            >
              <TileLayer url={template} />
              <MapEvents onBoundsChange={(b) => {
                setMinLat(Number(b.minLat.toFixed(4)));
                setMinLng(Number(b.minLng.toFixed(4)));
                setMaxLat(Number(b.maxLat.toFixed(4)));
                setMaxLng(Number(b.maxLng.toFixed(4)));
              }} />
            </MapContainer>
            
            {/* Download Overlay */}
            <div className="absolute bottom-4 left-4 right-4 z-[400] pointer-events-none flex justify-center">
               <div className="bg-white/95 backdrop-blur shadow-lg rounded-lg border border-slate-200 p-4 pointer-events-auto w-full max-w-sm">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-700">Estimated Tiles:</span>
                    <span className={`font-mono text-sm font-bold ${estimated > 10000 ? 'text-red-600' : 'text-blue-600'}`}>{estimated.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={downloading} onClick={download} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded flex items-center justify-center font-medium text-sm transition-colors">
                      <Download className="w-4 h-4 mr-2" />{downloading ? `Downloading ${progress}%` : 'Download View'}
                    </button>
                    <button disabled={downloading} onClick={clear} title="Clear Cache" className="px-3 py-2 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Right side: Settings */}
        <div className="flex flex-col gap-6 overflow-y-auto">
          <div className="border rounded-lg p-5 bg-slate-50 space-y-4 shadow-sm">
            <h3 className="font-semibold text-slate-700 text-sm">Download Settings</h3>
            
            <div>
              <label className="text-xs font-semibold text-slate-500">XYZ Tile URL</label>
              <input value={template} onChange={e => setTemplate(e.target.value)} className="mt-1 w-full px-3 py-2 rounded border border-slate-300 bg-white font-mono text-xs" />
              <p className="text-[10px] text-slate-500 mt-1 leading-tight">Must include {'{z}'}, {'{x}'}, {'{y}'}.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-500">
                Min Zoom
                <input type="number" min="0" max="19" value={minZoom} onChange={e => setMinZoom(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Max Zoom
                <input type="number" min="0" max="19" value={maxZoom} onChange={e => setMaxZoom(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" />
              </label>
            </div>
          </div>

          <div className="border rounded-lg p-5 bg-slate-50 space-y-4 shadow-sm">
            <h3 className="font-semibold text-slate-700 text-sm">Selected Region</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">North</label>
                <div className="px-2 py-1.5 rounded bg-white border border-slate-200 font-mono text-xs text-slate-700">{maxLat}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">South</label>
                <div className="px-2 py-1.5 rounded bg-white border border-slate-200 font-mono text-xs text-slate-700">{minLat}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">West</label>
                <div className="px-2 py-1.5 rounded bg-white border border-slate-200 font-mono text-xs text-slate-700">{minLng}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase">East</label>
                <div className="px-2 py-1.5 rounded bg-white border border-slate-200 font-mono text-xs text-slate-700">{maxLng}</div>
              </div>
            </div>
          </div>
          
          {downloading && (
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden shadow-inner">
              <div className="bg-blue-600 h-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {message && <div className="p-3 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800 leading-tight">{message}</div>}
        </div>
      </div>
      
      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed shrink-0">
        <strong>Note:</strong> Drag and zoom the map to select the exact bounding box to download. Downloading stores the tiles inside your browser's IndexedDB for offline field access.
      </div>
    </div>
  );
}
