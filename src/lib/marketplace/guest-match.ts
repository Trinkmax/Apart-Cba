import { digitsOnly } from "./display";
import { normalizeEmail } from "./reservation-view";

/**
 * ¿Una ficha de `guests` del PMS es la misma persona que el pedido de la web?
 *
 * El pedido web es lead-first: el email NO está verificado (cualquiera puede
 * tipear el email de otro). Reusar la ficha sólo por email le colgaría la
 * reserva —y el historial— a otra persona, así que se exigen los DOS datos:
 * el mismo email (sin distinguir mayúsculas) y el mismo WhatsApp. Si no, la
 * acción crea una ficha nueva; nunca se pisa una ficha existente con datos
 * de la web.
 *
 * El teléfono se compara por los últimos 8 dígitos: la ficha puede estar
 * cargada como "351 555-1234" y el pedido llega como "+5493515551234".
 */

/** Cuántos dígitos finales del teléfono tienen que coincidir. */
export const PHONE_MATCH_DIGITS = 8;

/** Cuántas fichas con ese email se miran como candidatas (emails de relleno compartidos). */
export const GUEST_MATCH_CANDIDATES = 50;

/** Últimos 8 dígitos del teléfono, o null si tiene menos (no alcanza para comparar). */
export function phoneTail(raw: string | null | undefined): string | null {
  const d = digitsOnly(raw);
  return d.length >= PHONE_MATCH_DIGITS ? d.slice(-PHONE_MATCH_DIGITS) : null;
}

export interface GuestMatchCandidate {
  id: string;
  email: string | null;
  phone: string | null;
}

export interface WebGuestContact {
  email: string | null | undefined;
  phone: string | null | undefined;
}

/** Mismo email (sin mayúsculas/espacios) Y mismos últimos 8 dígitos del teléfono. */
export function isSameWebGuest(existing: Omit<GuestMatchCandidate, "id">, web: WebGuestContact): boolean {
  const email = normalizeEmail(web.email);
  if (!email || normalizeEmail(existing.email) !== email) return false;
  const a = phoneTail(existing.phone);
  return a !== null && a === phoneTail(web.phone);
}

/**
 * La ficha a reusar entre las candidatas (vienen ordenadas de la más vieja a
 * la más nueva), o null → hay que crear una ficha nueva.
 */
export function pickReusableGuest<T extends GuestMatchCandidate>(
  candidates: readonly T[] | null | undefined,
  web: WebGuestContact,
): T | null {
  return (candidates ?? []).find((g) => isSameWebGuest(g, web)) ?? null;
}

/**
 * Email como patrón ILIKE literal: escapa los comodines de LIKE (`\`, `%`,
 * `_`; el `_` es común en emails). PostgREST convierte `*` en `%` sin forma de
 * escaparlo, así que el filtro de la base sólo ACOTA candidatas: la decisión
 * exacta la toma `pickReusableGuest`.
 */
export function emailIlikePattern(email: string): string {
  return normalizeEmail(email).replace(/[\\%_]/g, (c) => `\\${c}`);
}
