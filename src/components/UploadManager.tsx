import React, { useState, useEffect } from 'react';
import { Upload, Trash2, Database, Map as MapIcon, RadioTower, CheckCircle2, Circle } from 'lucide-react';
import { saveTower, clearTowers, getTowers, Tower } from '../lib/db';
import { MapPackage } from '../lib/db';

export default function UploadManager() {
  const [towerCount, setTowerCount] = useState(0);
  const [packages, setPackages] = useState<MapPackage[]>([]);

  useEffect(() => {
    updateStats();
    
    import('../lib/mapState').then(module => {
      setPackages([...module.getActivePackages()]);
      module.subscribePmtilesFile(() => {
        setPackages([...module.getActivePackages()]);
      });
    });
  }, []);

  const updateStats = async () => {
    const towers = await getTowers();
    setTowerCount(towers.length);
  };

  const handleTowerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      let imported = 0;
      for (let i = 1; i < lines.length; i++) { // Skip header
        const parts = lines[i].split(',').map(p => p.trim());
        if (parts.length >= 5) {
          const tower: Tower = {
            id: parts[0] || `T-${i}`,
            name: parts[1],
            lat: parseFloat(parts[2]),
            lng: parseFloat(parts[3]),
            height: parseFloat(parts[4])
          };
          if (!isNaN(tower.lat) && !isNaN(tower.lng) && !isNaN(tower.height)) {
            await saveTower(tower);
            imported++;
          }
        }
      }
      alert(`Imported ${imported} towers successfully.`);
      await updateStats();
    } catch (err) {
      console.error('Failed to parse towers:', err);
      alert('Error parsing CSV file.');
    } finally {
      e.target.value = '';
    }
  };

  const handlePackageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      import('../lib/mapState').then(async module => {
        const success = await module.addMapPackage(file);
        if (!success) {
          alert('Failed to validate PMTiles package.');
        }
      });
    }
    e.target.value = '';
  };

  const togglePackage = (id: string, enabled: boolean) => {
    import('../lib/mapState').then(module => {
      module.togglePackage(id, enabled);
    });
  };

  const removePackage = (id: string) => {
    if (confirm('Are you sure you want to remove this map package?')) {
      import('../lib/db').then(async db => {
        await db.deleteMapPackage(id);
        import('../lib/mapState').then(module => module.loadPackagesFromDb());
      });
    }
  };

  return (
    <div className="w-full h-full bg-white rounded-xl overflow-y-auto shadow-inner border-4 border-white p-6 md:p-8 space-y-8">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <h2 className="text-xl font-bold text-slate-800 flex items-center tracking-tight">
          <Database className="w-6 h-6 mr-3 text-blue-600" />
          Offline Data Storage
        </h2>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest hidden sm:block">Data Sources</span>
      </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tiles Section */}
          <div className="border rounded-lg p-5 bg-slate-50 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <MapIcon className="w-5 h-5 text-slate-600" />
                <h3 className="font-medium text-slate-700">Offline Maps (PMTiles)</h3>
              </div>
              <span className={`text-sm font-semibold px-2 py-1 rounded bg-blue-100 text-blue-700`}>
                {packages.length} Installed
              </span>
            </div>
            
            <p className="text-sm text-slate-500 mb-4">
              Manage your local .pmtiles map archives for offline map rendering.
            </p>

            <div className="space-y-3 mb-6">
              {packages.length === 0 ? (
                <div className="text-center py-6 bg-white border border-dashed border-slate-300 rounded-lg text-slate-400 text-sm">
                  No map packages installed.
                </div>
              ) : (
                packages.map(pkg => (
                  <div key={pkg.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <button onClick={() => togglePackage(pkg.id, !pkg.enabled)} className="text-blue-600 focus:outline-none flex-shrink-0">
                        {pkg.enabled ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-slate-300" />}
                      </button>
                      <div className="flex flex-col truncate">
                        <span className="font-semibold text-slate-800 text-sm truncate">{pkg.name}</span>
                        <span className="text-xs text-slate-500">
                          {(pkg.size / (1024 * 1024)).toFixed(2)} MB • {pkg.tileType === 1 ? 'Vector (MVT)' : 'Raster'} • Zoom {pkg.minZoom}-{pkg.maxZoom}
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={() => removePackage(pkg.id)}
                      className="ml-4 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                      title="Remove package"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex space-x-2">
              <label className="flex-1 cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center justify-center transition-colors">
                <Upload className="w-4 h-4 mr-2" />
                Install PMTiles Package
                <input type="file" accept=".pmtiles" className="hidden" onChange={handlePackageUpload} />
              </label>
            </div>
          </div>

          {/* Towers Section */}
          <div className="border rounded-lg p-5 bg-slate-50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <RadioTower className="w-5 h-5 text-slate-600" />
                <h3 className="font-medium text-slate-700">Tower Database</h3>
              </div>
              <span className="text-sm font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {towerCount} stored
              </span>
            </div>
            
            <p className="text-sm text-slate-500 mb-4 h-10">
              Upload a CSV file containing tower data. Format: id,name,lat,lng,height
            </p>

            <div className="flex space-x-2">
              <label className="flex-1 cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center justify-center transition-colors">
                <Upload className="w-4 h-4 mr-2" />
                Upload CSV
                <input type="file" accept=".csv" className="hidden" onChange={handleTowerUpload} />
              </label>
              
              <button 
                onClick={async () => {
                  if (confirm('Are you sure you want to delete all towers?')) {
                    await clearTowers();
                    await updateStats();
                  }
                }}
                className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Clear all towers"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Terrain Section */}
          <div className="border rounded-lg p-5 bg-slate-50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <MapIcon className="w-5 h-5 text-slate-600" />
                <h3 className="font-medium text-slate-700">Terrain Data</h3>
              </div>
              <span className="text-sm font-semibold bg-slate-200 text-slate-700 px-2 py-1 rounded">
                Pending
              </span>
            </div>
            
            <p className="text-sm text-slate-500 mb-4 h-10">
              Upload SRTM (.hgt) or GeoTIFF (.tif) files for elevation profiles.
            </p>

            <div className="flex space-x-2">
              <label className="flex-1 cursor-pointer bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded flex items-center justify-center transition-colors">
                <Upload className="w-4 h-4 mr-2" />
                Upload Terrain File
                <input type="file" accept=".hgt,.tif,.tiff" className="hidden" onChange={(e) => {
                  if (e.target.files?.length) {
                    alert('Terrain parsing requires geotiff.js. File selected: ' + e.target.files[0].name);
                    e.target.value = '';
                  }
                }} />
              </label>
            </div>
          </div>
          
        </div>
    </div>
  );
}
