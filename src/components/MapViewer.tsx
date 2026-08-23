import React, { useEffect, useState, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getTowers, Tower } from '../lib/db';
import { calculateDistance, calculateLineOfSight } from '../lib/geo';
import { subscribePmtilesFile } from '../lib/mapState';

export default function MapViewer() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [selectedTowers, setSelectedTowers] = useState<Tower[]>([]);
  const [losResult, setLosResult] = useState<any>(null);
  const [hasMapLayer, setHasMapLayer] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lineSourceId = 'los-line';

  useEffect(() => {
    getTowers().then(setTowers);
  }, []);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': '#e2e8f0'
            }
          }
        ]
      },
      center: [69.3451, 30.3753], // Pakistan
      zoom: 5
    });

    map.current.on('load', () => {
      // Add empty source and layer for LoS line
      if (!map.current) return;
      map.current.addSource(lineSourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      map.current.addLayer({
        id: 'los-line-layer',
        type: 'line',
        source: lineSourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#ef4444',
          'line-width': 3,
          'line-dasharray': [2, 2]
        }
      });
      
      updatePmtilesLayer();
    });

    const unsubscribe = subscribePmtilesFile(() => {
      updatePmtilesLayer();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const updatePmtilesLayer = () => {
    if (!map.current) return;
    
    // We import getActivePackages to see what needs rendering
    import('../lib/mapState').then(module => {
      const activePackages = module.getActivePackages();
      
      // Clean up previous dynamically added pmtiles sources and layers
      // MapLibre doesn't have an easy "get all sources of type X" without iterating styles.
      // Easiest is to keep track of added source IDs or just infer from currentPackages state.
      const currentStyle = map.current?.getStyle();
      if (!currentStyle) return;

      Object.keys(currentStyle.sources).forEach(sourceId => {
        if (sourceId.startsWith('pmtiles-pkg-')) {
          const layerId = `layer-${sourceId}`;
          if (map.current?.getLayer(layerId)) {
            map.current.removeLayer(layerId);
          }
          if (map.current?.getSource(sourceId)) {
            map.current.removeSource(sourceId);
          }
        }
      });

      // Add enabled packages
      activePackages.forEach(pkg => {
        if (!pkg.enabled || !map.current) return;

        const sourceId = `pmtiles-pkg-${pkg.id}`;
        const layerId = `layer-${sourceId}`;

        // 1=Mvt (Vector), 2=Png, 3=Jpeg, 4=Webp (Raster)
        const isVector = pkg.tileType === 1;

        if (isVector) {
          // Vector tiles require a style. For offline preview, if we don't have style.json, 
          // we can just add a generic wireframe/line style.
          map.current.addSource(sourceId, {
            type: 'vector',
            url: `pmtiles://${pkg.name}`
          });
          
          // Generic fallback vector layer just to show data exists
          map.current.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            'source-layer': Object.keys(pkg).length ? 'default' : 'default', // PMTiles doesn't expose default source-layer easily without metadata
            paint: {
              'line-color': '#3b82f6',
              'line-width': 1
            }
          }, 'los-line-layer');
        } else {
          // Raster
          map.current.addSource(sourceId, {
            type: 'raster',
            url: `pmtiles://${pkg.name}`,
            tileSize: 256
          });

          map.current.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {}
          }, 'los-line-layer'); // Insert before the line layer
        }
      });
      
      setHasMapLayer(activePackages.length > 0);
    });
  };

  const handleTowerClick = (tower: Tower) => {
    setSelectedTowers(prev => {
      const isSelected = prev.find(t => t.id === tower.id);
      if (isSelected) {
        return prev.filter(t => t.id !== tower.id);
      }
      if (prev.length >= 2) {
        return [prev[1], tower];
      }
      return [...prev, tower];
    });
  };

  // Update markers
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    towers.forEach(tower => {
      const isSelected = selectedTowers.some(t => t.id === tower.id);
      const color = isSelected ? '#ef4444' : '#3b82f6';
      
      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
        <div class="font-medium text-slate-800">${tower.name}</div>
        <div class="text-xs text-slate-500">ID: ${tower.id}</div>
        <div class="text-xs text-slate-600">Height: ${tower.height}m</div>
        <div class="text-[10px] text-slate-400 mt-1">${tower.lat.toFixed(4)}, ${tower.lng.toFixed(4)}</div>
      `);

      const marker = new maplibregl.Marker({ color })
        .setLngLat([tower.lng, tower.lat]) // Note: maplibre uses [lng, lat]
        .setPopup(popup)
        .addTo(map.current!);
        
      const el = marker.getElement();
      el.addEventListener('click', (e) => {
        // Prevent map click if we had one
        e.stopPropagation();
        handleTowerClick(tower);
      });

      markersRef.current.push(marker);
    });
  }, [towers, selectedTowers]);

  // Update LoS line and calculations
  useEffect(() => {
    if (selectedTowers.length === 2) {
      const [t1, t2] = selectedTowers;
      const dist = calculateDistance(t1.lat, t1.lng, t2.lat, t2.lng);
      const los = calculateLineOfSight(dist, t1.height, t2.height);
      setLosResult({ distance: dist, ...los });

      if (map.current && map.current.getSource(lineSourceId)) {
        const source = map.current.getSource(lineSourceId) as maplibregl.GeoJSONSource;
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [t1.lng, t1.lat],
              [t2.lng, t2.lat]
            ]
          }
        });
        
        map.current.setPaintProperty(
          'los-line-layer', 
          'line-color', 
          los.isClearLoS ? '#22c55e' : '#ef4444'
        );
      }
    } else {
      setLosResult(null);
      if (map.current && map.current.getSource(lineSourceId)) {
        const source = map.current.getSource(lineSourceId) as maplibregl.GeoJSONSource;
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        });
      }
    }
  }, [selectedTowers]);

  return (
    <div className="w-full h-full bg-slate-300 rounded-xl overflow-hidden shadow-inner flex flex-col relative border-4 border-white">
      <div className="absolute top-4 left-4 z-[1000] bg-white/90 backdrop-blur shadow-md rounded-md px-4 py-2 border border-slate-200 flex justify-between items-center space-x-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Field Map View</h2>
        <div className="text-xs font-medium text-slate-700">
          {selectedTowers.length === 0 && "Select a tower to begin"}
          {selectedTowers.length === 1 && "Select a second tower for LoS"}
          {selectedTowers.length === 2 && (
            <button 
              onClick={() => setSelectedTowers([])}
              className="text-blue-600 hover:text-blue-800 hover:underline font-bold"
            >
              Clear Selection
            </button>
          )}
        </div>
      </div>
      
      <div className="relative flex-1">
        <div ref={mapContainer} style={{ height: '100%', width: '100%', minHeight: '400px', zIndex: 1 }} />
        
        {losResult && selectedTowers.length === 2 && (
          <div className="absolute bottom-6 left-6 z-[1000] bg-white/95 backdrop-blur rounded-lg border border-slate-300 shadow-2xl p-4 w-[360px]">
            <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 border-b border-slate-200 pb-2">
              Link Profile: {selectedTowers[0].name} ↔ {selectedTowers[1].name}
            </h3>
            <div className="flex justify-between items-center mb-4">
               <div className="bg-blue-50 border border-blue-100 p-2 rounded w-full">
                  <p className="text-[10px] text-blue-600 font-bold uppercase">Air Distance</p>
                  <p className="text-lg font-mono font-bold text-blue-900">{losResult.distance.toFixed(2)} km</p>
               </div>
            </div>
            <div className="space-y-2 text-xs font-mono text-slate-600">
              <div className="flex justify-between items-end border-b border-slate-100 pb-1">
                <span>Max Radio Horizon</span>
                <span className="font-bold text-slate-900">{losResult.maxDistance.toFixed(2)} km</span>
              </div>
              <div className="flex justify-between items-end border-b border-slate-100 pb-1">
                <span>Earth Bulge (Mid)</span>
                <span className="font-bold text-slate-900">{losResult.earthBulgeMeters.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between items-end border-b border-slate-100 pb-1">
                <span>60% Fresnel Radius</span>
                <span className="font-bold text-slate-900">{losResult.requiredClearance.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between items-center mt-3 pt-2">
                <span className="font-bold font-sans text-slate-700">LoS Status:</span>
                <span className={`px-2 py-1 rounded font-bold text-[10px] ${losResult.isClearLoS ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {losResult.isClearLoS ? "CLEAR (60% FRESNEL)" : "OBSTRUCTED"}
                </span>
              </div>
              {!losResult.isClearLoS && (
                <div className="text-[10px] text-red-500 mt-2 leading-tight font-sans">
                  Earth curvature blocks the required Fresnel zone clearance for this distance and tower height combination.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
