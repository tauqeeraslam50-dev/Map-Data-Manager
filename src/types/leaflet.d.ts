declare module 'leaflet' {
  interface MapOptions {
    /** Existing project option used by the map initialization; accepted for compatibility with the current Leaflet configuration. */
    updateWhenIdle?: boolean;
  }
}
