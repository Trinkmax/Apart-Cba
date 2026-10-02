/**
 * Aritmética de fechas de calendario para contratos de alquiler — sin `Date`
 * local.
 *
 * Todo trabaja sobre strings `YYYY-MM-DD` y `Date.UTC`, igual que
 * `src/lib/finance/prorate.ts`: la zona horaria del proceso (UTC en Vercel,
 * -03 en una notebook) nunca puede correr un vencimiento un día.
 *
 * Un contrato se mide en MESES DE CONTRATO a partir del día de inicio: el
 * período N arranca `addMonthsClamped(inicio, N-1)`. Se calcula siempre desde
 * la fecha de inicio original (no encadenando sumas), porque un contrato que
 * arranca el 31/01 tiene que volver al 31/03 y no quedar pegado en el 28.
 */

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = parseYmd(v);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** [año, mes 1-12, día]. No valida: usá `isYmd` antes si viene de afuera. */
export function parseYmd(ymd: string): [number, number, number] {
  return [Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10))];
}

export function toYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcOf(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  return Date.UTC(y, m - 1, d);
}

/** Días de calendario de `a` a `b` (positivo si `b` es posterior). */
export function diffDays(a: string, b: string): number {
  return Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
}

export function addDays(ymd: string, days: number): string {
  return new Date(utcOf(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Suma meses de calendario. Si el día no existe en el mes de destino, se
 * pega al último día (31/01 + 1 mes = 28/02 o 29/02).
 */
export function addMonthsClamped(ymd: string, months: number): string {
  const [y, m, d] = parseYmd(ymd);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  return toYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Primer día del mes de `ymd` → `YYYY-MM-01`. Es la clave de un índice mensual. */
export function monthOf(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Suma meses a una clave de mes `YYYY-MM-01`. */
export function addMonthsToMonth(month: string, months: number): string {
  return addMonthsClamped(monthOf(month), months);
}

/** Meses enteros entre dos claves de mes (`b` − `a`). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = parseYmd(a);
  const [by, bm] = parseYmd(b);
  return by * 12 + bm - (ay * 12 + am);
}

/**
 * Meses de contrato completos transcurridos desde `start` hasta `ymd`
 * (0 durante el primer mes). Respeta el pegado a fin de mes de
 * `addMonthsClamped`: el 28/02 ya cumplió un mes de un contrato del 31/01.
 */
export function contractMonthsElapsed(start: string, ymd: string): number {
  if (ymd < start) return -1;
  let n = Math.max(0, monthsBetween(monthOf(start), monthOf(ymd)) - 1);
  while (addMonthsClamped(start, n + 1) <= ymd) n++;
  return n;
}
