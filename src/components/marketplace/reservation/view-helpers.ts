import type { ReservationView } from "@/lib/marketplace/contracts";
import type { StageTone } from "@/lib/marketplace/guest-stage";

/**
 * Decisiones chicas de la vista de seguimiento, puras para poder testearlas.
 */

/**
 * Titular de la etapa con el punto coral de la marca cuando la noticia es
 * buena. Si el texto ya cierra con "." el punto coral lo reemplaza; con "!" o
 * "?" no se agrega.
 */
export function stageTitleParts(title: string, tone: StageTone): { text: string; dot: boolean } {
  const positive = tone === "info" || tone === "action" || tone === "ok";
  const trimmed = title.trim();
  if (!positive || /[!?]$/.test(trimmed)) return { text: trimmed, dot: false };
  return { text: trimmed.replace(/\.$/, ""), dot: true };
}

/**
 * Query para volver a buscar con los mismos datos. Las fechas sólo viajan si
 * la llegada todavía no pasó.
 */
export function stayQuery(view: Pick<ReservationView, "stay">, todayIso: string): string {
  const q = new URLSearchParams();
  if (view.stay.check_in >= todayIso) {
    q.set("checkin", view.stay.check_in);
    q.set("checkout", view.stay.check_out);
  }
  if (view.stay.guests > 0) q.set("huespedes", String(view.stay.guests));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Hasta cuándo prometemos responder un pedido: la hora del pedido más las
 * horas de respuesta de Configuración → Web y cobros (24 h por defecto).
 * NO es el vencimiento del pedido (`expires_at`, 48 h desde la base): ese es
 * el plazo en el que se libera solo si nadie lo mira, y nunca se muestra como
 * promesa. Si por algún motivo venciera antes, manda el vencimiento.
 */
export function responseDeadline(
  createdAtIso: string,
  responseHours: number,
  expiresAtIso?: string | null,
): string | null {
  const base = Date.parse(createdAtIso);
  if (!Number.isFinite(base)) return null;
  const hours = Number.isFinite(responseHours) && responseHours > 0 ? responseHours : 24;
  let deadline = base + hours * 3_600_000;
  const expires = expiresAtIso ? Date.parse(expiresAtIso) : Number.NaN;
  if (Number.isFinite(expires) && expires < deadline) deadline = expires;
  return new Date(deadline).toISOString();
}

/** Lo que queda para pagar al llegar, contando lo que ya se cobró de más. */
export function amountDueOnArrival(money: ReservationView["money"]): number {
  const sena = money.sena ?? 0;
  if (money.paid > sena) return Math.max(0, money.total - money.paid);
  return money.resto;
}

/** Link de Google Maps para una dirección de Córdoba. */
export function mapsUrl(address: string): string {
  const q = /c[oó]rdoba/i.test(address) ? address : `${address}, Córdoba`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** CBU en grupos legibles: "0170 0996 4000 0012 3456 78". */
export function groupCbu(cbu: string): string {
  const digits = cbu.replace(/\D+/g, "");
  if (digits.length !== 22) return cbu;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}
