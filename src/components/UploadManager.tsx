import React, { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Database, Map as MapIcon, RadioTower, CheckCircle2, Circle, FolderOpen } from 'lucide-react';
import { saveTower, saveTowers, clearTowers, getTowers, Tower } from '../lib/db';
import { MapPackage } from '../lib/db';

const parseCSV = async (file: File): Promise<number> => {
  const text = await file.text();
  const lines = text.split('\n');
  const towersToSave: Tower[] = [];
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length >= 5) {
      const tower: Tower = { 
        id: parts[0]?.trim() || `T-${Date.now()}-${i}`, 
        name: parts[1]?.trim(), 
        lat: parseFloat(parts[2]?.trim()), 
        lng: parseFloat(parts[3]?.trim()), 
        height: parseFloat(parts[4]?.trim()) 
      };
      if (!isNaN(tower.lat) && !isNaN(tower.lng) && !isNaN(tower.height)) {
        towersToSave.push(tower);
        imported++;
      }
    }
    
    // Batch DB insertions in chunks to avoid blocking and improve performance
    if (towersToSave.length >= 2500) {
      await saveTowers(towersToSave);
      towersToSave.length = 0;
    }
  }

  if (towersToSave.length > 0) {
    await saveTowers(towersToSave);
  }
  
  return imported;
};

export default function UploadManager() {
  const [towerCount, setTowerCount] = useState(0);
  const [packages, setPackages] = useState<MapPackage[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('No folder selected');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{text: string, type: 'success'|'error'|'info'} | null>(null);
  const packageInputRef = useRef<HTMLInputElement>(null);
  const towerInputRef = useRef<HTMLInputElement>(null);
  const terrainInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const showMessage = (text: string, type: 'success'|'error'|'info' = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  useEffect(() => {
    updateStats();
    let unsubscribe: (() => void) | undefined;
    import('../lib/mapState').then(module => {
      setPackages([...module.getActivePackages()]);
      unsubscribe = module.subscribePmtilesFile(() => setPackages([...module.getActivePackages()]));
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const openPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current;
    if (!input) {
      console.error('File picker input is not mounted');
      return;
    }
    input.value = '';
    input.click();
  };

  const updateStats = async () => {
    const towers = await getTowers();
    setTowerCount(towers.length);
  };

  const handleTowerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const imported = await parseCSV(file);
      showMessage(`Imported ${imported} towers successfully.`, 'success');
      await updateStats();
    } catch (err) {
      console.error('Failed to parse towers:', err);
      showMessage('Error parsing CSV file.', 'error');
    } finally { 
      setBusy(false);
      e.target.value = ''; 
    }
  };

  const handlePackageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const module = await import('../lib/mapState');
      const success = await module.addMapPackage(file);
      if (!success) showMessage('Failed to validate PMTiles package.', 'error');
      else showMessage('Installed PMTiles package successfully.', 'success');
    } catch (err) {
      console.error('Failed to install PMTiles package:', err);
      showMessage(`Failed to install PMTiles package: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(false); e.target.value = ''; }
  };

  const handleTerrainUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showMessage(`Terrain file selected: ${file.name}\nTerrain parsing will be enabled in the DEM phase.`, 'info');
    e.target.value = '';
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name;
    const folder = firstPath.includes('/') ? firstPath.split('/')[0] : firstPath;
    setSelectedFolder(folder);
    console.info('Selected map folder:', folder, 'Files:', files.length);
    
    const pmtilesFiles = files.filter(f => f.name.toLowerCase().endsWith('.pmtiles'));
    const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));

    if (pmtilesFiles.length > 0 || csvFiles.length > 0) {
      setBusy(true);
      try {
        const module = await import('../lib/mapState');
        for (const file of pmtilesFiles) {
          await module.addMapPackage(file);
        }
        
        for (const file of csvFiles) {
          await parseCSV(file);
        }
        await updateStats();
        showMessage(`Successfully imported ${pmtilesFiles.length} map package(s) and parsed ${csvFiles.length} tower file(s) from ${folder}.`, 'success');
      } catch (err) {
        console.error('Failed to process folder:', err);
        showMessage('An error occurred while processing the folder.', 'error');
      } finally {
        setBusy(false);
      }
    } else {
      showMessage(`Selected folder: ${folder}\nDetected ${files.length} file(s) but no PMTiles or CSV files found.`, 'error');
    }

    e.target.value = '';
  };

  const togglePackage = (id: string, enabled: boolean) => {
    import('../lib/mapState').then(module => module.togglePackage(id, enabled));
  };

  const removePackage = async (id: string) => {
    setBusy(true);
    try {
      const db = await import('../lib/db');
      await db.deleteMapPackage(id);
      const module = await import('../lib/mapState');
      await module.loadPackagesFromDb();
      showMessage('Map package removed.', 'success');
    } catch (err) {
      console.error('Failed to remove package', err);
      showMessage('Failed to remove package', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full h-full bg-white rounded-xl overflow-y-auto shadow-inner border-4 border-white p-6 md:p-8 space-y-8">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <h2 className="text-xl font-bold text-slate-800 flex items-center tracking-tight"><Database className="w-6 h-6 mr-3 text-blue-600" />Offline Data Storage</h2>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest hidden sm:block">Data Sources</span>
      </div>

      {message && (
        <div className={`p-4 rounded-md text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          {message.text}
        </div>
      )}

      <div className="border rounded-lg p-5 bg-slate-50">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="font-medium text-slate-700">Map Data Folder</h3>
            <p className="text-sm text-slate-500 mt-1">Select a local folder containing PMTiles, HGT, GeoTIFF and other offline map data.</p>
            <p className="text-xs text-blue-600 mt-2 font-mono truncate">{selectedFolder}</p>
          </div>
          <div className="relative shrink-0">
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center justify-center transition-colors cursor-pointer">
              <FolderOpen className="w-4 h-4 mr-2" />Select Map Folder
              <input ref={folderInputRef} type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" multiple {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={handleFolderSelect} />
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-5 bg-slate-50 md:col-span-2">
          <div className="flex items-center justify-between mb-4"><div className="flex items-center space-x-2"><MapIcon className="w-5 h-5 text-slate-600" /><h3 className="font-medium text-slate-700">Offline Maps (PMTiles)</h3></div><span className="text-sm font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700">{packages.length} Installed</span></div>
          <p className="text-sm text-slate-500 mb-4">Manage local .pmtiles map archives for offline map rendering.</p>
          <div className="space-y-3 mb-6">{packages.length === 0 ? <div className="text-center py-6 bg-white border border-dashed border-slate-300 rounded-lg text-slate-400 text-sm">No map packages installed.</div> : packages.map(pkg => <div key={pkg.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm"><div className="flex items-center space-x-3 flex-1 min-w-0"><button type="button" onClick={() => togglePackage(pkg.id, !pkg.enabled)} className="text-blue-600 focus:outline-none flex-shrink-0">{pkg.enabled ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-slate-300" />}</button><div className="flex flex-col truncate"><span className="font-semibold text-slate-800 text-sm truncate">{pkg.name}</span><span className="text-xs text-slate-500">{(pkg.size / (1024 * 1024)).toFixed(2)} MB • {pkg.tileType === 1 ? 'Vector (MVT)' : 'Raster'} • Zoom {pkg.minZoom}-{pkg.maxZoom}</span></div></div><button type="button" onClick={() => removePackage(pkg.id)} className="ml-4 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0" title="Remove package"><Trash2 className="w-4 h-4" /></button></div>)}</div>
          <div className="relative">
            <button type="button" disabled={busy} onClick={() => openPicker(packageInputRef)} className="w-full cursor-pointer disabled:opacity-60 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center justify-center transition-colors"><Upload className="w-4 h-4 mr-2" />{busy ? 'Reading PMTiles…' : 'Install PMTiles Package'}</button>
            <input ref={packageInputRef} type="file" accept=".pmtiles,application/octet-stream" className="sr-only" onChange={handlePackageUpload} />
          </div>
        </div>

        <div className="border rounded-lg p-5 bg-slate-50">
          <div className="flex items-center justify-between mb-4"><div className="flex items-center space-x-2"><RadioTower className="w-5 h-5 text-slate-600" /><h3 className="font-medium text-slate-700">Tower Database</h3></div><span className="text-sm font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded">{towerCount} stored</span></div>
          <p className="text-sm text-slate-500 mb-4 h-10">Upload a CSV file containing tower data. Format: id,name,lat,lng,height</p>
          <div className="relative"><button type="button" onClick={() => openPicker(towerInputRef)} className="w-full cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center justify-center transition-colors"><Upload className="w-4 h-4 mr-2" />Upload CSV</button><input ref={towerInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={handleTowerUpload} /></div>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await clearTowers(); await updateStats(); setBusy(false); }} className="mt-2 w-full px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50" title="Clear all towers"><Trash2 className="w-4 h-4 mx-auto" /></button>
        </div>

        <div className="border rounded-lg p-5 bg-slate-50">
          <div className="flex items-center justify-between mb-4"><div className="flex items-center space-x-2"><MapIcon className="w-5 h-5 text-slate-600" /><h3 className="font-medium text-slate-700">Terrain Data</h3></div><span className="text-sm font-semibold bg-slate-200 text-slate-700 px-2 py-1 rounded">Pending</span></div>
          <p className="text-sm text-slate-500 mb-4 h-10">Upload SRTM (.hgt) or GeoTIFF (.tif) files for elevation profiles.</p>
          <div className="relative"><button type="button" onClick={() => openPicker(terrainInputRef)} className="w-full cursor-pointer bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded flex items-center justify-center transition-colors"><Upload className="w-4 h-4 mr-2" />Upload Terrain File</button><input ref={terrainInputRef} type="file" accept=".hgt,.tif,.tiff,application/octet-stream,image/tiff" className="sr-only" onChange={handleTerrainUpload} /></div>
        </div>
      </div>
    </div>
  );
}
