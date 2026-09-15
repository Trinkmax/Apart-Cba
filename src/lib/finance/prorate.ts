/**
 * Aritmética de meses y noches — sin `Date` local.
 *
 * Todo trabaja sobre strings `YYYY-MM-DD` y `Date.UTC`: la zona horaria del
 * proceso no puede mover un día. `new Date(y, m-1, 1).toISOString()` (lo que
 * hace hoy settlements.ts para armar el período) da bien en Vercel sólo porque
 * el proceso corre en UTC; en una máquina en -03 corre el mes un día.
 *
 * REGLA DE ORO: el fin del mes es EXCLUSIVO — el día 1 del mes siguiente —,
 * igual que `check_out_date`. Con el fin inclusivo (el último día del mes) y
 * una resta de fechas que ya cuenta noches, un mes completo da 29/30 o 30/31:
 * es el bug de las 11 líneas automáticas de septiembre 2026 ("(29/30 días)",
 * ROSARIO, BSAS1, ORO, ITU…). Resultados cuenta noches exactas con esto y
 * marca `prorrateo_viejo` donde la liquidación contó otra cosa.
 */

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcOf(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

/** Índice lineal del mes: comparable con `<` y restable. `year*12 + (month-1)`. */
export function periodIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** Inversa de `periodIndex`. */
export function periodFromIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** Mes al que pertenece una fecha `YYYY-MM-DD` (se ignora lo que venga después del día). */
export function periodOf(ymd: string): { year: number; month: number; index: number } {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return { year, month, index: periodIndex(year, month) };
}

/** Primer día del mes, primer día del mes siguiente (exclusivo) y días del mes. */
export function monthBounds(
  year: number,
  month: number,
): { start: string; endExclusive: string; days: number } {
  const next = periodFromIndex(periodIndex(year, month) + 1);
  return {
    start: `${year}-${pad2(month)}-01`,
    endExclusive: `${next.year}-${pad2(next.month)}-01`,
    days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

/**
 * true si el string empieza con una fecha `YYYY-MM-DD` que existe en el
 * calendario. '2026-02-30' tiene forma de fecha pero no existe: comparada como
 * string pasa, y mandada a PostgREST devuelve 22008 ("date/time field value out
 * of range") y tira abajo la consulta entera. Las filas manuales de la
 * liquidación sólo validan el formato, así que Resultados las filtra acá.
 */
export function isRealYmd(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Noches entre dos fechas con fin exclusivo. Nunca negativo. */
export function nightsBetween(fromYmd: string, toYmdExclusive: string): number {
  const diff = Math.round((utcOf(toYmdExclusive) - utcOf(fromYmd)) / DAY_MS);
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

/**
 * Noches de una estadía [checkIn, checkOut) que caen dentro del mes.
 * Un check-in el último día del mes es 1 noche en ese mes (no 0, como daba el
 * fin inclusivo, que además la salteaba de la liquidación).
 */
export function monthOverlapNights(
  checkIn: string,
  checkOut: string,
  year: number,
  month: number,
): number {
  const b = monthBounds(year, month);
  const start = checkIn > b.start ? checkIn : b.start;
  const end = checkOut < b.endExclusive ? checkOut : b.endExclusive;
  return nightsBetween(start, end);
}
