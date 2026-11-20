import { DEFAULT_ORG_TIMEZONE, ymdInTz } from "@/lib/dates";
import type { Channel } from "./types";

/**
 * Textos del lado saliente (qué le falta leer a la OTA). Puro y sin
 * dependencias de React: lo usan la tabla de Canales, la ficha de la conexión
 * y la herramienta de Tex.
 */

/** «14:52», o «mañana 02:52» si la próxima lectura cae al otro día. */
export function formatTimeInTz(
  iso: string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_ORG_TIMEZONE,
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return ymdInTz(at, timeZone) === ymdInTz(now, timeZone) ? time : `mañana ${time}`;
}

/**
 * «20/11 12:02»: un momento que ya pasó, siempre con el día. Va en el texto de
 * avisos que se vuelven a armar en cada lectura: tiene que dar lo mismo hoy que
 * mañana (el aviso se deduplica y se recuerda descartado por su texto).
 */
export function formatStampInTz(iso: string, timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const ymd = ymdInTz(at, timeZone);
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)} ${time}`;
}

/**
 * Cómo se le pide a la OTA que lea YA, sin esperar su próxima pasada. No hay
 * forma de hacerlo desde acá: con iCal la que viene a leer es ella.
 */
export const OTA_REFRESH_HINT: Record<Channel, string> = {
  airbnb:
    "En Airbnb, abrí el calendario del anuncio → Disponibilidad → Conectar calendarios, y actualizá el calendario de rentOS.",
  booking:
    "En Booking.com, entrá a Tarifas y disponibilidad → Sincronizar calendarios, y actualizá la conexión de rentOS.",
};

/** El atajo a esa pantalla, cuando se conoce el anuncio. */
export function otaRefreshUrl(channel: Channel, externalListingId: string | null): string | null {
  if (channel !== "airbnb" || !externalListingId || !/^\d{5,25}$/.test(externalListingId)) {
    return null;
  }
  return `https://www.airbnb.com/multicalendar/${externalListingId}/availability-settings`;
}
