import React, { useMemo, useState } from 'react';
import { Download, Globe2, Trash2, MapPinned } from 'lucide-react';
import { DEFAULT_TILE_URL, clearOfflineTiles, downloadTileRegion, estimateDownload, registerOfflineProtocol } from '../lib/onlineMap';

const PAKISTAN = { minLat: 23.5, minLng: 60.8, maxLat: 37.2, maxLng: 77.2 };

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
    if (estimated > 3000) { setMessage(`This area/zoom selection contains ${estimated.toLocaleString()} tiles. Reduce the area or maximum zoom to 3,000 tiles or fewer.`); return; }
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
    <div className="w-full h-full bg-white rounded-xl overflow-y-auto shadow-inner border-4 border-white p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4"><div><h2 className="text-xl font-bold text-slate-800 flex items-center"><Globe2 className="w-6 h-6 mr-3 text-blue-600" />Online Map Downloader</h2><p className="text-sm text-slate-500 mt-1">Preview an online XYZ tile service and save a bounded area into the local offline cache.</p></div><MapPinned className="w-8 h-8 text-slate-300" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-lg p-5 bg-slate-50 space-y-4"><h3 className="font-semibold text-slate-700">Tile Service</h3><div><label className="text-xs font-semibold text-slate-500">XYZ Tile URL</label><input value={template} onChange={e => setTemplate(e.target.value)} className="mt-1 w-full px-3 py-2 rounded border border-slate-300 bg-white font-mono text-xs" /><p className="text-[11px] text-slate-500 mt-1">Required placeholders: {'{z}'}, {'{x}'}, {'{y}'}. Use a provider that permits your intended offline caching.</p></div><div className="grid grid-cols-3 gap-3"><label className="text-xs font-semibold text-slate-500">Min Zoom<input type="number" min="0" max="19" value={minZoom} onChange={e => setMinZoom(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label><label className="text-xs font-semibold text-slate-500">Max Zoom<input type="number" min="0" max="19" value={maxZoom} onChange={e => setMaxZoom(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label><div className="text-xs font-semibold text-slate-500">Estimated Tiles<div className="mt-1 px-2 py-2 rounded bg-white border border-slate-300 font-mono text-slate-700">{estimated.toLocaleString()}</div></div></div></div>
        <div className="border rounded-lg p-5 bg-slate-50 space-y-4"><h3 className="font-semibold text-slate-700">Download Area</h3><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-500">South / Min Lat<input type="number" step="0.1" value={minLat} onChange={e => setMinLat(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label><label className="text-xs font-semibold text-slate-500">West / Min Lng<input type="number" step="0.1" value={minLng} onChange={e => setMinLng(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label><label className="text-xs font-semibold text-slate-500">North / Max Lat<input type="number" step="0.1" value={maxLat} onChange={e => setMaxLat(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label><label className="text-xs font-semibold text-slate-500">East / Max Lng<input type="number" step="0.1" value={maxLng} onChange={e => setMaxLng(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded border border-slate-300 bg-white" /></label></div><div className="flex gap-3"><button disabled={downloading} onClick={download} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded flex items-center justify-center font-medium"><Download className="w-4 h-4 mr-2" />{downloading ? `Downloading ${progress}%` : 'Download for Offline Use'}</button><button disabled={downloading} onClick={clear} className="px-4 py-2.5 rounded border border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button></div></div>
      </div>
      {downloading && <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden"><div className="bg-blue-600 h-full transition-all" style={{ width: `${progress}%` }} /></div>}
      {message && <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">{message}</div>}
      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed"><strong>Important:</strong> This mechanism stores raster XYZ tiles locally; it does not convert them to PMTiles. For production or large-area datasets, use a provider/data source whose terms explicitly permit offline caching. The built-in OpenStreetMap example is intended for small tests and development, not bulk extraction.</div>
    </div>
  );
}
