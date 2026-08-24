export interface Coordinate {
  lat: number;
  lon: number;
}

export function parseCoordinateText(value: string): Coordinate | null {
  const parts = value.split(/[ ,]+/).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  if (parts.length !== 2) return null;
  const [lat, lon] = parts;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function formatCoordinate(value: Coordinate, digits = 6): string {
  return `${value.lat.toFixed(digits)}, ${value.lon.toFixed(digits)}`;
}
