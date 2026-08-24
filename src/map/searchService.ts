export interface MapSearchResult {
  name: string;
  lat: number;
  lon: number;
  source: 'online' | 'offline';
  type?: string;
}

const OFFLINE_PLACES: MapSearchResult[] = [
  { name: 'Islamabad, Pakistan', lat: 33.6844, lon: 73.0479, source: 'offline', type: 'city' },
  { name: 'Rawalpindi, Pakistan', lat: 33.5651, lon: 73.0169, source: 'offline', type: 'city' },
  { name: 'Lahore, Pakistan', lat: 31.5204, lon: 74.3587, source: 'offline', type: 'city' },
  { name: 'Karachi, Pakistan', lat: 24.8607, lon: 67.0011, source: 'offline', type: 'city' },
  { name: 'Peshawar, Pakistan', lat: 34.0151, lon: 71.5249, source: 'offline', type: 'city' },
  { name: 'Quetta, Pakistan', lat: 30.1798, lon: 66.9750, source: 'offline', type: 'city' },
  { name: 'Multan, Pakistan', lat: 30.1575, lon: 71.5249, source: 'offline', type: 'city' },
  { name: 'Faisalabad, Pakistan', lat: 31.4504, lon: 73.1350, source: 'offline', type: 'city' },
  { name: 'Gujranwala, Pakistan', lat: 32.1877, lon: 74.1945, source: 'offline', type: 'city' },
  { name: 'Sialkot, Pakistan', lat: 32.4945, lon: 74.5229, source: 'offline', type: 'city' },
  { name: 'Abbottabad, Pakistan', lat: 34.1688, lon: 73.2215, source: 'offline', type: 'city' },
  { name: 'Murree, Pakistan', lat: 33.9073, lon: 73.3903, source: 'offline', type: 'town' },
  { name: 'Gilgit, Pakistan', lat: 35.9208, lon: 74.3083, source: 'offline', type: 'city' },
  { name: 'Skardu, Pakistan', lat: 35.2971, lon: 75.6333, source: 'offline', type: 'city' },
  { name: 'Muzaffarabad, Pakistan', lat: 34.3700, lon: 73.4711, source: 'offline', type: 'city' },
  { name: 'Hyderabad, Pakistan', lat: 25.3960, lon: 68.3578, source: 'offline', type: 'city' },
  { name: 'Sukkur, Pakistan', lat: 27.7244, lon: 68.8228, source: 'offline', type: 'city' },
  { name: 'Bahawalpur, Pakistan', lat: 29.3956, lon: 71.6836, source: 'offline', type: 'city' },
];

export function searchOffline(query: string): MapSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return OFFLINE_PLACES
    .map((place) => ({ place, score: place.name.toLowerCase().startsWith(q) ? 0 : place.name.toLowerCase().includes(q) ? 1 : 2 }))
    .filter((x) => x.score < 2)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.place)
    .slice(0, 8);
}

export async function searchOnline(query: string, signal?: AbortSignal): Promise<MapSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&countrycodes=pk&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Online search failed (${response.status})`);
  const data = await response.json() as Array<{ display_name?: string; lat?: string; lon?: string; type?: string }>;
  return data
    .map((item) => ({ name: item.display_name ?? q, lat: Number(item.lat), lon: Number(item.lon), source: 'online' as const, type: item.type }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}
