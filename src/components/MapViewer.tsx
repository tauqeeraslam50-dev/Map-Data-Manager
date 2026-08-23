import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getTowers, Tower } from '../lib/db';
import { calculateDistance, calculateLineOfSight } from '../lib/geo';
import { subscribePmtilesFile } from '../lib/mapState';
import { DEFAULT_TILE_URL, registerOfflineProtocol } from '../lib/onlineMap';

export default function MapViewer() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [selectedTowers, setSelectedTowers] = useState<Tower[]>([]);
  const [losResult, setLosResult] = useState<any>(null);
  const [hasMapLayer, setHasMapLayer] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<'online' | 'offline'>(() => localStorage.getItem('rf-map-mode') === 'offline' ? 'offline' : 'online');
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lineSourceId = 'los-line';
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => { getTowers().then(setTowers); }, []);

  const fitOfflineBounds = useCallback(() => {
    if (!map.current) return;
    try {
      const raw = localStorage.getItem('rf-offline-bounds');
      if (!raw) return;
      const b = JSON.parse(raw);
      if ([b.minLat, b.minLng, b.maxLat, b.maxLng].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) {
        map.current.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 50, duration: 700, maxZoom: 16 });
      }
    } catch (error) { console.warn('Could not fit offline map bounds:', error); }
  }, []);

  const setBaseMap = useCallback((mode: 'online' | 'offline') => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    registerOfflineProtocol();
    const sourceId = 'base-map-source';
    const layerId = 'base-map-layer';
    if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
    if (map.current.getSource(sourceId)) map.current.removeSource(sourceId);
    map.current.addSource(sourceId, { type: 'raster', tiles: [mode === 'offline' ? 'offline://tiles/{z}/{x}/{y}' : DEFAULT_TILE_URL], tileSize: 256, minzoom: 0, maxzoom: 19 });
    map.current.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 1 } }, 'los-line-layer');
    setMapMode(mode);
    if (mode === 'offline') requestAnimationFrame(() => fitOfflineBounds());
  }, [fitOfflineBounds]);

  const updatePmtilesLayer = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    import('../lib/mapState').then(module => {
      if (!map.current) return;
      const activePackages = module.getActivePackages().filter(pkg => pkg.enabled && pkg.file);
      const currentStyle = map.current.getStyle();
      if (!currentStyle) return;
      const dynamicLayerIds = (currentStyle.layers || []).map(layer => layer.id).filter(id => id.startsWith('pmtiles-layer-'));
      dynamicLayerIds.forEach(layerId => { if (map.current?.getLayer(layerId)) map.current.removeLayer(layerId); });
      const dynamicSourceIds = Object.keys(currentStyle.sources).filter(id => id.startsWith('pmtiles-source-'));
      dynamicSourceIds.forEach(sourceId => { if (map.current?.getSource(sourceId)) map.current.removeSource(sourceId); });
      let renderedPackageCount = 0;
      let combinedBounds: maplibregl.LngLatBounds | null = null;
      activePackages.forEach(pkg => {
        const sourceId = `pmtiles-source-${pkg.id}`;
        const archiveUrl = `pmtiles://${pkg.id}`;
        try {
          if (pkg.tileType === 1) {
            if (!pkg.vectorLayers?.length) return;
            map.current!.addSource(sourceId, { type: 'vector', url: archiveUrl });
            pkg.vectorLayers.forEach((sourceLayer, index) => {
              const safeIndex = `${pkg.id}-${index}`;
              map.current?.addLayer({ id: `pmtiles-layer-${safeIndex}-fill`, type: 'fill', source: sourceId, 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.16 } }, 'los-line-layer');
              map.current?.addLayer({ id: `pmtiles-layer-${safeIndex}-line`, type: 'line', source: sourceId, 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#1d4ed8', 'line-width': 1.2, 'line-opacity': 0.85 } }, 'los-line-layer');
              map.current?.addLayer({ id: `pmtiles-layer-${safeIndex}-point`, type: 'circle', source: sourceId, 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3, 'circle-color': '#1d4ed8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } }, 'los-line-layer');
            });
          } else {
            map.current!.addSource(sourceId, { type: 'raster', url: archiveUrl, tileSize: 256 });
            map.current!.addLayer({ id: `pmtiles-layer-${pkg.id}-raster`, type: 'raster', source: sourceId, paint: { 'raster-opacity': 1 } }, 'los-line-layer');
          }
          renderedPackageCount++;
          if (pkg.bounds) {
            const [minLon, minLat, maxLon, maxLat] = pkg.bounds;
            if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
              const b = new maplibregl.LngLatBounds([minLon, minLat], [maxLon, maxLat]);
              if (!combinedBounds) combinedBounds = b; else combinedBounds.extend(b);
            }
          }
        } catch (error) {
          console.error(`Failed to render PMTiles package ${pkg.name}:`, error);
          setMapError(`Could not render ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      setHasMapLayer(renderedPackageCount > 0);
      if (renderedPackageCount > 0 && combinedBounds && !combinedBounds.isEmpty()) requestAnimationFrame(() => map.current?.fitBounds(combinedBounds!, { padding: 40, duration: 500, maxZoom: 12 }));
    }).catch(error => { console.error('Failed to update PMTiles layers:', error); setHasMapLayer(false); setMapError(String(error)); });
  }, []);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    registerOfflineProtocol();
    const initialMode = localStorage.getItem('rf-map-mode') === 'offline' ? 'offline' : 'online';
    map.current = new maplibregl.Map({ container: mapContainer.current, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dbeafe' } }] }, center: [69.3451, 30.3753], zoom: 5 });
    map.current.on('error', (event: any) => { const message = event?.error?.message || event?.error || 'Unknown MapLibre error'; console.error('MapLibre error:', event?.error || event); setMapError(String(message)); });
    const handleMapLoad = () => {
      if (!map.current) return;
      map.current.addSource(lineSourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
      map.current.addLayer({ id: 'los-line-layer', type: 'line', source: lineSourceId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [2, 2] } });
      setBaseMap(initialMode);
      updatePmtilesLayer();
      setMapLoaded(true);
    };
    map.current.on('load', handleMapLoad);
    const unsubscribe = subscribePmtilesFile(() => updatePmtilesLayer());
    const modeListener = (event: Event) => { const mode = ((event as CustomEvent<'online' | 'offline'>).detail || 'online'); setBaseMap(mode); };
    window.addEventListener('rf-map-mode-changed', modeListener);
    return () => { unsubscribe(); window.removeEventListener('rf-map-mode-changed', modeListener); map.current?.remove(); map.current = null; };
  }, [setBaseMap, updatePmtilesLayer]);

  const handleTowerClick = (tower: Tower) => setSelectedTowers(prev => { const selected = prev.find(t => t.id === tower.id); if (selected) return prev.filter(t => t.id !== tower.id); if (prev.length >= 2) return [prev[1], tower]; return [...prev, tower]; });

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    towers.forEach(tower => {
      const isSelected = selectedTowers.some(t => t.id === tower.id);
      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`<div style="font-weight:600">${tower.name}</div><div style="font-size:11px;color:#64748b">ID: ${tower.id}</div><div style="font-size:11px;color:#475569">Height: ${tower.height}m</div><div style="font-size:10px;color:#94a3b8">${tower.lat.toFixed(4)}, ${tower.lng.toFixed(4)}</div>`);
      const marker = new maplibregl.Marker({ color: isSelected ? '#ef4444' : '#3b82f6' }).setLngLat([tower.lng, tower.lat]).setPopup(popup).addTo(map.current!);
      marker.getElement().addEventListener('click', event => { event.stopPropagation(); handleTowerClick(tower); });
      markersRef.current.push(marker);
    });
  }, [towers, selectedTowers, mapLoaded]);

  useEffect(() => {
    if (selectedTowers.length === 2) {
      const [t1, t2] = selectedTowers;
      const dist = calculateDistance(t1.lat, t1.lng, t2.lat, t2.lng);
      const los = calculateLineOfSight(dist, t1.height, t2.height);
      setLosResult({ distance: dist, ...los });
      if (map.current && mapLoaded && map.current.getSource(lineSourceId)) { const source = map.current.getSource(lineSourceId) as maplibregl.GeoJSONSource; source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[t1.lng, t1.lat], [t2.lng, t2.lat]] } }); map.current.setPaintProperty('los-line-layer', 'line-color', los.isClearLoS ? '#22c55e' : '#ef4444'); }
    } else {
      setLosResult(null);
      if (map.current && mapLoaded && map.current.getSource(lineSourceId)) (map.current.getSource(lineSourceId) as maplibregl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });
    }
  }, [selectedTowers, mapLoaded]);

  const changeMode = (mode: 'online' | 'offline') => { localStorage.setItem('rf-map-mode', mode); setMapMode(mode); setBaseMap(mode); window.dispatchEvent(new CustomEvent('rf-map-mode-changed', { detail: mode })); };

  return (
    <div className="w-full h-full bg-slate-300 rounded-xl overflow-hidden shadow-inner flex flex-col relative border-4 border-white">
      <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur shadow-md rounded-md px-4 py-2 border border-slate-200 flex items-center gap-3">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Offline Map View</h2>
        <button onClick={() => changeMode('online')} className={`text-[10px] px-2 py-1 rounded font-bold ${mapMode === 'online' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>ONLINE</button>
        <button onClick={() => changeMode('offline')} className={`text-[10px] px-2 py-1 rounded font-bold ${mapMode === 'offline' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600'}`}>OFFLINE</button>
        <span className="text-[10px] text-slate-500">{mapMode === 'offline' ? 'Imported map data' : 'Online preview'}</span>
      </div>
      <div className="relative flex-1">
        <div ref={mapContainer} style={{ height: '100%', width: '100%', minHeight: '400px', zIndex: 1 }} />
        {!hasMapLayer && <div className="absolute top-20 right-4 z-[1000] bg-white/90 backdrop-blur rounded-md border border-slate-200 shadow px-3 py-2 text-xs text-slate-600">Base map: {mapMode === 'online' ? 'Online XYZ' : 'Offline tile cache'} • PMTiles overlay optional</div>}
        {mapError && <div className="absolute top-20 left-4 right-4 z-[1001] bg-red-50/95 backdrop-blur rounded-md border border-red-200 shadow px-3 py-2 text-xs text-red-700"><strong>Map error:</strong> {mapError}</div>}
        {losResult && selectedTowers.length === 2 && <div className="absolute bottom-6 left-6 z-[1000] bg-white/95 backdrop-blur rounded-lg border border-slate-300 shadow-2xl p-4 w-[360px]"><h3 className="text-xs font-bold text-slate-500 uppercase mb-3 border-b border-slate-200 pb-2">Link Profile: {selectedTowers[0].name} ↔ {selectedTowers[1].name}</h3><div className="bg-blue-50 border border-blue-100 p-2 rounded w-full mb-4"><p className="text-[10px] text-blue-600 font-bold uppercase">Air Distance</p><p className="text-lg font-mono font-bold text-blue-900">{losResult.distance.toFixed(2)} km</p></div><div className="space-y-2 text-xs font-mono text-slate-600"><div className="flex justify-between border-b border-slate-100 pb-1"><span>Max Radio Horizon</span><span className="font-bold text-slate-900">{losResult.maxDistance.toFixed(2)} km</span></div><div className="flex justify-between border-b border-slate-100 pb-1"><span>Earth Bulge (Mid)</span><span className="font-bold text-slate-900">{losResult.earthBulgeMeters.toFixed(2)} m</span></div><div className="flex justify-between border-b border-slate-100 pb-1"><span>60% Fresnel Radius</span><span className="font-bold text-slate-900">{losResult.requiredClearance.toFixed(2)} m</span></div><div className="flex justify-between items-center mt-3 pt-2"><span className="font-bold font-sans text-slate-700">LoS Status:</span><span className={`px-2 py-1 rounded font-bold text-[10px] ${losResult.isClearLoS ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{losResult.isClearLoS ? 'CLEAR (60% FRESNEL)' : 'OBSTRUCTED'}</span></div></div></div>}
      </div>
      <div className="absolute bottom-2 right-2 z-[1000] bg-white/90 px-2 py-1 rounded text-[9px] text-slate-500">© OpenStreetMap contributors</div>
    </div>
  );
}
