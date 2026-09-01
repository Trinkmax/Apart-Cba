import type { Channel } from "./types";

/**
 * Textos por OTA que aparecen en más de una pantalla (asistente de conexión y
 * diálogo de cambio de enlace). Viven acá porque tienen que decir exactamente
 * lo mismo en los dos lados: cuando Booking o Airbnb renombran un menú, se
 * corrige en un solo lugar y no queda media app explicando un camino viejo.
 */

/** Dónde saca la usuaria el calendario del anuncio (lo que NOSOTROS leemos). */
export const OTA_EXPORT_PATH: Record<Channel, string> = {
  airbnb: "Airbnb → Calendario → Disponibilidad → Conectar calendarios",
  booking:
    "Booking.com → Tarifas y disponibilidad → Sincronizar calendarios → Exportar calendario",
};

/** Dónde pega NUESTRO calendario dentro de la OTA (lo que la OTA lee). */
export const OTA_IMPORT_PATH: Record<Channel, string> = {
  airbnb: "Airbnb → Calendario → Disponibilidad → Conectar calendarios",
  booking: "Booking.com → Tarifas y disponibilidad → Sincronizar calendarios",
};

/** Forma real de cada URL: sirve de ejemplo y de control visual al pegarla. */
export const OTA_FEED_PLACEHOLDER: Record<Channel, string> = {
  airbnb: "https://www.airbnb.com/calendar/ical/…ics?s=…",
  booking: "https://ical.booking.com/v1/export?t=…",
};
