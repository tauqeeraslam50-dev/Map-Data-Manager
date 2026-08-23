// Earth radius in kilometers
const EARTH_RADIUS_KM = 6371;

/**
 * Calculates the Haversine distance between two points on the Earth.
 * @returns Distance in kilometers.
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return EARTH_RADIUS_KM * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Basic Line of Sight (LoS) Check factoring in earth curvature.
 * Standard atmospheric refraction often uses an effective earth radius factor of 4/3.
 */
export function calculateLineOfSight(
  distanceKm: number,
  h1Meters: number,
  h2Meters: number,
  frequencyGhz: number = 5.8
) {
  // Effective earth radius (K = 4/3)
  const Re = EARTH_RADIUS_KM * (4/3);
  
  // Maximum theoretical line of sight distance (radio horizon) in km
  // d_max = sqrt(2 * Re * h1) + sqrt(2 * Re * h2)
  const maxDistance = 
    Math.sqrt(2 * Re * (h1Meters / 1000)) + 
    Math.sqrt(2 * Re * (h2Meters / 1000));
    
  const isWithinHorizon = distanceKm <= maxDistance;

  // Fresnel zone calculation at midpoint (where it's widest)
  // F1 = 17.32 * sqrt((d1 * d2) / (f * d)) where d is in km and f in GHz
  // At midpoint, d1 = d2 = d/2
  const d1 = distanceKm / 2;
  const d2 = distanceKm / 2;
  const maxFresnelRadiusMeters = distanceKm > 0 
    ? 17.32 * Math.sqrt((d1 * d2) / (frequencyGhz * distanceKm))
    : 0;
      
  // Earth bulge at midpoint in meters
  // h_bulge = (d1 * d2) / (2 * Re) * 1000
  const earthBulgeMeters = (d1 * d2) / (2 * Re) * 1000;
  
  // Determine if direct LoS clears the earth bulge with 60% of Fresnel zone
  const averageHeight = (h1Meters + h2Meters) / 2;
  const clearanceMeters = averageHeight - earthBulgeMeters;
  const requiredClearance = 0.6 * maxFresnelRadiusMeters;

  const isClearLoS = clearanceMeters >= requiredClearance;

  return {
    maxDistance,
    isWithinHorizon,
    maxFresnelRadiusMeters,
    earthBulgeMeters,
    clearanceMeters,
    requiredClearance,
    isClearLoS
  };
}
