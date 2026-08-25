import 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    /** Legacy option retained for compatibility with the existing map configuration. */
    updateWhenIdle?: boolean;
  }

  interface TileLayerOptions {
    /** Legacy option retained for compatibility with the existing map configuration. */
    updateWhenIdle?: boolean;
  }
}
