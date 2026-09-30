/**
 * Config del mapa de /buscar SIN importar mapbox (así la página puede decidir
 * si muestra la columna del mapa sin cargar la librería).
 */
export const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();
export const MAP_ENABLED = MAPBOX_TOKEN.length > 0;

/** Centro de Córdoba capital (sin resultados con coordenadas). */
export const CORDOBA_CENTER = { latitude: -31.4201, longitude: -64.1888 } as const;

/** Paleta de la marca para retocar el estilo light-v11 de Mapbox. */
export const MAP_COLORS = {
  land: "#F6F0E4",
  green: "#DDE9D4",
  water: "#CFE3E6",
  building: "#ECE3D2",
  landuseOther: "#EFE7D8",
} as const;
