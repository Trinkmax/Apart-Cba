/**
 * Formato tolerante para lo que Tex muestra y le pasa al modelo (nov-2026).
 *
 * Puro y client-safe. Existe porque `formatMoney` de `src/lib/format.ts` tira
 * con monedas raras (las preferencias de cobro de los propietarios usan
 * códigos como `ARS_EFECTIVO`) y una herramienta de Tex nunca puede caerse
 * por cómo se dibuja un número.
 */

const MONEY_SYMBOL: Record<string, string> = { ARS: "$", USD: "US$", EUR: "€", BRL: "R$", UYU: "$U", CLP: "CLP$" };

/** "$ 50.000" · "US$ 1.250,50" · "ARS_EFECTIVO 1.000". Nunca tira. */
export function money(amount: number | string | null | undefined, currency = "ARS"): string {
  const n = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  const code = (currency || "ARS").toUpperCase();
  const base = code.split("_")[0];
  const symbol = MONEY_SYMBOL[base] ?? base;
  const abs = Math.abs(n);
  const decimals = Math.round(abs * 100) % 100 === 0 ? 0 : 2;
  const body = abs.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}${symbol} ${body}`;
}

/** Suma por moneda (nunca mezcla monedas). */
export function sumByCurrency<T>(rows: T[], amount: (r: T) => number, currency: (r: T) => string | null | undefined) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const c = (currency(r) || "ARS").toUpperCase();
    const v = Number(amount(r)) || 0;
    out[c] = Math.round(((out[c] ?? 0) + v) * 100) / 100;
  }
  return out;
}

/** "$ 120.000 · US$ 300" a partir de un objeto por moneda. */
export function moneyByCurrency(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency).filter(([, v]) => Math.abs(v) > 0.004);
  if (entries.length === 0) return money(0);
  return entries.map(([c, v]) => money(v, c)).join(" · ");
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-11-14" → "sáb 14 nov". Con año si no es el de `refYmd`. */
export function shortDate(ymd: string | null | undefined, refYmd?: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = WEEKDAYS_SHORT[dt.getUTCDay()];
  const sameYear = !refYmd || refYmd.slice(0, 4) === String(y);
  return `${wd} ${d} ${MONTHS_SHORT[m - 1]}${sameYear ? "" : ` ${y}`}`;
}

/** "14 al 18 nov" (o "28 nov al 2 dic"). Fin exclusivo como las reservas: es el día de salida. */
export function dateRange(fromYmd: string, toYmd: string): string {
  const [, fm, fd] = fromYmd.split("-").map(Number);
  const [, tm, td] = toYmd.split("-").map(Number);
  if (fm === tm) return `${fd} al ${td} ${MONTHS_SHORT[tm - 1]}`;
  return `${fd} ${MONTHS_SHORT[fm - 1]} al ${td} ${MONTHS_SHORT[tm - 1]}`;
}

/** Noches entre dos días `YYYY-MM-DD` (check-out excluido). */
export function nightsBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Valida un `YYYY-MM-DD` real (no 2026-02-31). */
export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Recorta un texto largo para mandarle al modelo (notas, descripciones). */
export function clip(s: string | null | undefined, max = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Normaliza para comparar nombres: sin tildes, minúsculas, espacios simples. */
export function fold(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un link interno de la app: empieza con "/" pero NO con "//" ni "/\\" (esos
 * los navegadores los toman como otro dominio). Lo que escribe el modelo o
 * viene de la base (un pedido especial de un huésped) pasa por acá.
 */
export function isInternalHref(href: string | null | undefined): href is string {
  return typeof href === "string" && /^\/(?![\/\\])/.test(href);
}
