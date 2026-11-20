/**
 * El enlace del calendario de la OTA ya no existe.
 *
 * En Booking cada conexión de calendario tiene su propio enlace. Cuando alguien
 * borra la conexión (o la borra y crea otra), el enlace viejo deja de existir:
 * Booking contesta HTTP 400 con `{"detail":"Invalid Token"}`, lo mismo que para
 * un enlace inventado. No es un error pasajero y no se arregla esperando.
 *
 * Viaggiato (20/11/2026): tres veces en cinco días el mismo anuncio de Booking
 * fue y vino entre CENTRO y SALGUERO. Cada vez que se pegaba un enlace nuevo en
 * uno, el del otro moría a los minutos. El aviso que salía era el genérico («No
 * se puede leer el calendario… volvé a pegar el enlace»), dos horas después, y
 * no decía lo importante: al borrarse la conexión, Booking TAMPOCO lee nuestro
 * calendario de ese departamento. SALGUERO quedó con una estadía de tres noches
 * sin cerrar en Booking.
 *
 * Puro; lo usa el sincronizador (dispatch.ts) y la carga de un enlace.
 */
import type { Channel } from "./types";

/** Con esto empieza `health.last_error` cuando el enlace se dio de baja. */
export const LINK_GONE_ERROR = "El enlace ya no existe";

export function isFeedLinkGone(
  channel: Channel,
  httpStatus: number | null | undefined,
  errorBody: string | null | undefined,
): boolean {
  // Sólo la firma que se verificó. Un 400 de Booking sin ese texto puede ser
  // pasajero y sigue por el camino de siempre (3 fallos, margen de 2 horas).
  if (channel !== "booking" || httpStatus !== 400) return false;
  return /invalid\s*token/i.test(errorBody ?? "");
}

/**
 * Cuánto antes o después de la caída de un enlace cuenta el cambio de enlace de
 * OTRA conexión del mismo canal. Medido en Viaggiato: el otro murió 19, 16 y 7
 * minutos alrededor del cambio (dos veces después, una antes).
 */
export const SIBLING_WINDOW_MS = 90 * 60 * 1000;

export interface SiblingFeedChange {
  unitCode: string;
  /** Cuándo se cargó un enlace nuevo en esa otra conexión. */
  changedAt: string | null | undefined;
}

/** El cambio de enlace de otra conexión más cercano a la caída, si hubo. */
export function siblingChangedNearby(
  siblings: SiblingFeedChange[],
  goneAtMs: number,
): { unitCode: string; changedAt: string } | null {
  let best: { unitCode: string; changedAt: string; gap: number } | null = null;
  for (const s of siblings) {
    if (!s.changedAt) continue;
    const at = Date.parse(s.changedAt);
    if (Number.isNaN(at)) continue;
    const gap = Math.abs(goneAtMs - at);
    if (gap > SIBLING_WINDOW_MS) continue;
    if (!best || gap < best.gap) best = { unitCode: s.unitCode, changedAt: s.changedAt, gap };
  }
  return best ? { unitCode: best.unitCode, changedAt: best.changedAt } : null;
}

export interface SiblingLinkState {
  unitCode: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null | undefined;
  lastError: string | null | undefined;
}

/**
 * Al cargar un enlace nuevo: las otras conexiones del mismo canal que dejaron
 * de funcionar hace poco. Si recién se tocó algo en la OTA, lo más probable es
 * que se haya borrado o reemplazado la conexión de alguna de ésas.
 */
export function siblingsThatJustDied(
  siblings: SiblingLinkState[],
  nowMs: number,
): Array<{ unitCode: string; lastSuccessAt: string }> {
  return siblings
    .filter((s) => {
      if (s.consecutiveFailures < 1 || !s.lastSuccessAt) return false;
      // Sólo un enlace que la OTA rechaza: un timeout o un 5xx de una lectura
      // suelta se arregla solo y no tiene nada que ver con lo que se tocó.
      if (!looksRejected(s.lastError)) return false;
      const ok = Date.parse(s.lastSuccessAt);
      return !Number.isNaN(ok) && nowMs - ok >= 0 && nowMs - ok <= SIBLING_WINDOW_MS;
    })
    .map((s) => ({ unitCode: s.unitCode, lastSuccessAt: s.lastSuccessAt as string }))
    .sort((a, b) => b.lastSuccessAt.localeCompare(a.lastSuccessAt));
}

/** El último error es de un enlace que la OTA ya no acepta (dado de baja, o 400/401/403/404/410). */
function looksRejected(lastError: string | null | undefined): boolean {
  if (!lastError) return false;
  return lastError.startsWith(LINK_GONE_ERROR) || /^HTTP (400|401|403|404|410)\b/.test(lastError);
}
