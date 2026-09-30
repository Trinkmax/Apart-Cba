import { formatCurrency } from "@/lib/marketplace/pricing";

/**
 * Formatos de los mails de apart (es-AR). Puros y deterministas: no dependen
 * del huso horario del servidor (Vercel corre en UTC) ni de la versión de ICU,
 * así lo que dice el mail coincide con la web y los tests no bailan.
 */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Argentina no tiene horario de verano: UTC−3 todo el año. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

interface Ymd {
  y: number;
  m: number; // 1–12
  d: number;
  dow: number; // 0 = domingo
}

/** Descompone un ISO YYYY-MM-DD sin pasar por el huso del servidor. */
function parseIso(iso: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dow };
}

/** "vie 3 oct". */
export function fmtDayShort(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return `${DIAS_CORTOS[p.dow]} ${p.d} ${MESES_CORTOS[p.m - 1]}`;
}

/** "viernes 3 de octubre". */
export function fmtDayLong(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return `${DIAS[p.dow]} ${p.d} de ${MESES[p.m - 1]}`;
}

/**
 * Rango de la estadía: "3 al 6 de octubre", "30 de septiembre al 3 de octubre",
 * "30 de diciembre de 2026 al 2 de enero de 2027".
 */
export function fmtStayRange(checkInIso: string, checkOutIso: string): string {
  const a = parseIso(checkInIso);
  const b = parseIso(checkOutIso);
  if (!a || !b) return `${checkInIso} al ${checkOutIso}`;
  if (a.y !== b.y) {
    return `${a.d} de ${MESES[a.m - 1]} de ${a.y} al ${b.d} de ${MESES[b.m - 1]} de ${b.y}`;
  }
  if (a.m !== b.m) return `${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`;
  return `${a.d} al ${b.d} de ${MESES[b.m - 1]}`;
}

/**
 * Fecha y hora de un timestamp en hora de Córdoba: "mié 1 oct, 14:30 h".
 * Para vencimientos (seña, pedido).
 */
export function fmtDateTimeAR(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return timestamp;
  const local = new Date(ms - AR_OFFSET_MS);
  const dow = DIAS_CORTOS[local.getUTCDay()];
  const d = local.getUTCDate();
  const mon = MESES_CORTOS[local.getUTCMonth()];
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${dow} ${d} ${mon}, ${hh}:${mm} h`;
}

/** "1 noche" / "4 noches". */
export function nightsLabel(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return v === 1 ? "1 noche" : `${v} noches`;
}

/** "1 huésped" / "3 huéspedes". */
export function guestsCountLabel(n: number): string {
  const v = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
  return v === 1 ? "1 huésped" : `${v} huéspedes`;
}

/** "$ 70.000" (sin decimales, como en la web). */
export function money(amount: number | null | undefined, currency: string = "ARS"): string {
  const n = amount != null && Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return formatCurrency(n, currency || "ARS");
}

/**
 * Primer nombre para saludar ("María José Pérez" → "María"). Los nombres
 * cargados todo en mayúsculas o minúsculas se normalizan ("LUCÍA" → "Lucía").
 */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  const shouting = first.length > 1 && first === first.toLocaleUpperCase("es-AR");
  const base = shouting ? first.toLocaleLowerCase("es-AR") : first;
  return base.charAt(0).toLocaleUpperCase("es-AR") + base.slice(1);
}

/** Código corto de la reserva para hablar con el equipo ("AP-7F3K2Q"). */
export function reservationCode(id: string): string {
  return `AP-${(id ?? "").replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
