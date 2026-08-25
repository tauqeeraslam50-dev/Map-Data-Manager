import React, { useState } from 'react';
import { FolderOpen, ScanSearch, CheckCircle2, AlertCircle } from 'lucide-react';

export default function OfflineMapControls() {
  const [folder, setFolder] = useState<string | null>(null);
  const [status, setStatus] = useState('Select your offline map folder.');
  const [scanning, setScanning] = useState(false);

  const selectFolder = async () => {
    if (!window.electronAPI) { setStatus('Run the Electron desktop app. Folder selection is not available in browser preview.'); return; }
    try {
      const result = await window.electronAPI.selectOfflineFolder();
      if (!result) return;
      setFolder(result.path);
      setScanning(true);
      const scan = await window.electronAPI.scanOfflineFolder();
      setScanning(false);
      if (!scan.tiles) { setStatus(`Scanned ${scan.files.toLocaleString()} files, but no z/x/y map tiles were found.`); return; }
      localStorage.setItem('rf-map-mode', 'offline');
      localStorage.setItem('rf-offline-folder', result.path);
      window.dispatchEvent(new CustomEvent('rf-offline-folder-selected', { detail: result }));
      window.dispatchEvent(new CustomEvent('rf-map-mode-changed', { detail: 'offline' }));
      setStatus(`${scan.tiles.toLocaleString()} tiles found • Zoom ${scan.zooms.join(', ')}`);
    } catch (error) {
      setScanning(false);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="absolute top-4 left-4 z-[2000] bg-white/95 backdrop-blur rounded-lg shadow-xl border border-slate-200 p-3 w-[390px]">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div><div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Offline Map View</div><div className="text-[10px] text-slate-500">Electron local tile server</div></div>
        <button onClick={selectFolder} disabled={scanning} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-semibold flex items-center gap-2"><FolderOpen className="w-4 h-4" />{scanning ? 'Scanning...' : 'Select Map Folder'}</button>
      </div>
      {folder && <div className="text-[10px] font-mono bg-slate-50 border rounded p-2 break-all mb-2">{folder}</div>}
      <div className={`text-[10px] flex items-center gap-1.5 ${status.includes('no z/x/y') || status.includes('not available') ? 'text-red-600' : 'text-slate-600'}`}>
        {status.includes('tiles found') ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : status.includes('no z/x/y') || status.includes('not available') ? <AlertCircle className="w-3.5 h-3.5" /> : <ScanSearch className="w-3.5 h-3.5" />}
        {status}
      </div>
    </div>
  );
}
