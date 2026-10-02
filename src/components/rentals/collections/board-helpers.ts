import { formatMoney } from "@/lib/format";
import { chargeDisplayState, type ChargeDisplayState } from "@/lib/rentals/labels";
import { addMonthsToMonth, isYmd, monthOf, monthsBetween } from "@/lib/rentals/ymd";

/**
 * Lógica pura del tablero de Cobranzas y de la cuenta corriente: estado de
 * cada fila, totales por moneda, orden de los grupos y saldo corrido. Sin I/O
 * (la usan el servidor para armar los datos y los componentes para filtrar).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Mes del tablero (?mes=YYYY-MM) ─────────────────────────────────────────

/** "2026-11" | "2026-11-01" → "2026-11-01"; cualquier otra cosa → mes de `today`. */
export function parseBoardMonth(raw: string | string[] | null | undefined, today: string): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return `${v}-01`;
  if (v && isYmd(v)) return `${v.slice(0, 7)}-01`;
  return `${today.slice(0, 7)}-01`;
}

/** "2026-11-01" → "2026-11" (para la URL). */
export function monthParam(month: string): string {
  return month.slice(0, 7);
}

export function shiftBoardMonth(month: string, delta: number): string {
  return addMonthsToMonth(month, delta);
}

/**
 * Rótulo relativo del ← mes → (Cobranzas y Comprobantes): sólo para el mes
 * actual y los contiguos. Julio visto desde octubre no es "el mes pasado":
 * devuelve null y alcanza con el nombre del mes.
 */
export function relativeMonthLabel(month: string, current: string): string | null {
  const d = monthsBetween(monthOf(current), monthOf(month));
  if (d === 0) return "Este mes";
  if (d === -1) return "Mes pasado";
  if (d === 1) return "Mes que viene";
  return null;
}

/** Último día del mes de una clave YYYY-MM-01. */
export function monthEnd(month: string): string {
  const next = addMonthsToMonth(month, 1);
  const d = new Date(`${next}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Filas del tablero ──────────────────────────────────────────────────────

export type BoardGroupKey = "vencido" | "parcial" | "pendiente" | "pagado";

export const BOARD_GROUP_ORDER: BoardGroupKey[] = ["vencido", "pendiente", "parcial", "pagado"];

export interface ChargeLite {
  status: string;
  due_date: string;
  subtotal: number;
  paid_amount: number;
  voided_at?: string | null;
}

/** Estado de un contrato en el mes: el peor de sus cargos (vencido > parcial > pendiente > pagado). */
export function rowStateOf(charges: ChargeLite[], today: string): BoardGroupKey {
  const states = charges.map((c) => chargeDisplayState(c, today)).filter((s): s is Exclude<ChargeDisplayState, "anulado"> => s !== "anulado");
  if (states.includes("vencido")) return "vencido";
  if (states.includes("parcial")) return "parcial";
  if (states.includes("pendiente")) return "pendiente";
  return "pagado";
}

export interface MoneyTotals {
  currency: string;
  expected: number;
  collected: number;
  pending: number;
  overdue: number;
}

/** Totales del mes por moneda: esperado = lo facturado; cobrado = lo imputado; el saldo se parte en vencido / por vencer. */
export function totalsByCurrency(charges: (ChargeLite & { currency: string })[], today: string): MoneyTotals[] {
  const map = new Map<string, MoneyTotals>();
  for (const c of charges) {
    if (c.voided_at || c.status === "anulado") continue;
    const t = map.get(c.currency) ?? { currency: c.currency, expected: 0, collected: 0, pending: 0, overdue: 0 };
    const subtotal = Number(c.subtotal);
    const paid = Math.min(Number(c.paid_amount), subtotal);
    const outstanding = Math.max(0, subtotal - paid);
    t.expected += subtotal;
    t.collected += paid;
    if (outstanding > 0.004) {
      if (c.due_date < today) t.overdue += outstanding;
      else t.pending += outstanding;
    }
    map.set(c.currency, t);
  }
  return [...map.values()]
    .map((t) => ({ ...t, expected: r2(t.expected), collected: r2(t.collected), pending: r2(t.pending), overdue: r2(t.overdue) }))
    .sort((a, b) => b.expected - a.expected);
}

/**
 * Importes de varias monedas sin mezclarlas: "$ 150.000,00 · US$ 100,00". Pesos
 * y dólares nunca se suman bajo un mismo símbolo. Una moneda que suma 0 no se
 * muestra; si todo suma 0, "$ 0,00" en la primera moneda de la lista.
 */
export function multiMoney(list: { amount: number; currency: string }[], fallbackCurrency = "ARS"): string {
  const m = new Map<string, number>();
  for (const x of list) m.set(x.currency, (m.get(x.currency) ?? 0) + (Number.isFinite(x.amount) ? x.amount : 0));
  const parts = [...m.entries()].map(([c, a]) => [c, r2(a)] as const).filter(([, a]) => Math.abs(a) >= 0.005);
  if (!parts.length) return formatMoney(0, list[0]?.currency ?? fallbackCurrency);
  return parts.map(([c, a]) => formatMoney(a, c)).join(" · ");
}

/** % cobrado (0-100, entero) para mostrar al lado del número. */
export function collectedPct(t: Pick<MoneyTotals, "expected" | "collected">): number {
  if (t.expected <= 0) return 0;
  return Math.min(100, Math.round((t.collected / t.expected) * 100));
}

export interface SortableRow {
  state: BoardGroupKey;
  dueDate: string | null;
  outstanding: number;
  tenantName: string;
}

/** Orden dentro de un grupo: lo que vence (o venció) antes primero; a igual fecha, la deuda más grande. */
export function compareRows(a: SortableRow, b: SortableRow): number {
  const da = a.dueDate ?? "9999-12-31";
  const db = b.dueDate ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (a.outstanding !== b.outstanding) return b.outstanding - a.outstanding;
  return a.tenantName.localeCompare(b.tenantName, "es");
}

export function groupRows<T extends SortableRow>(rows: T[]): { key: BoardGroupKey; rows: T[] }[] {
  return BOARD_GROUP_ORDER.map((key) => ({ key, rows: rows.filter((r) => r.state === key).sort(compareRows) })).filter((g) => g.rows.length > 0);
}

/** Búsqueda sin tildes ni mayúsculas. */
export function normalizeSearch(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesSearch(haystack: (string | null | undefined)[], query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const text = normalizeSearch(haystack.filter(Boolean).join(" "));
  return q.split(/\s+/).every((word) => text.includes(word));
}

// ─── Cuenta corriente: saldo corrido ────────────────────────────────────────

export interface LedgerInputCharge {
  id: string;
  date: string;
  createdAt: string;
  subtotal: number;
  voided: boolean;
}

export interface LedgerInputPayment {
  id: string;
  date: string;
  createdAt: string;
  amount: number;
  voided: boolean;
}

export type LedgerMovement =
  | { type: "charge"; id: string; date: string; debit: number; credit: 0; balance: number }
  | { type: "payment"; id: string; date: string; debit: 0; credit: number; balance: number };

/**
 * Extracto en orden cronológico con el saldo después de cada movimiento
 * (positivo = debe; negativo = saldo a favor). A igual fecha, primero los
 * cargos y después los pagos. Lo anulado se muestra pero no mueve el saldo.
 */
export function buildRunningBalance(charges: LedgerInputCharge[], payments: LedgerInputPayment[]): LedgerMovement[] {
  type Row = { type: "charge" | "payment"; id: string; date: string; createdAt: string; amount: number; voided: boolean };
  const rows: Row[] = [
    ...charges.map((c) => ({ type: "charge" as const, id: c.id, date: c.date, createdAt: c.createdAt, amount: Number(c.subtotal), voided: c.voided })),
    ...payments.map((p) => ({ type: "payment" as const, id: p.id, date: p.date, createdAt: p.createdAt, amount: Number(p.amount), voided: p.voided })),
  ];
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type !== b.type) return a.type === "charge" ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
  let balance = 0;
  return rows.map((r) => {
    const effective = r.voided ? 0 : r2(r.amount);
    if (r.type === "charge") {
      balance = r2(balance + effective);
      return { type: "charge", id: r.id, date: r.date, debit: effective, credit: 0, balance };
    }
    balance = r2(balance - effective);
    return { type: "payment", id: r.id, date: r.date, debit: 0, credit: effective, balance };
  });
}
