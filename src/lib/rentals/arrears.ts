import { round2 } from "@/lib/finance/booking-economics";
import { addDays } from "./ymd";

/**
 * Causal de resolución por falta de pago (art. 1219 inc. c CCyC): "falta de
 * pago de la prestación dineraria convenida durante DOS PERÍODOS
 * CONSECUTIVOS". No alcanza con dos cargos vencidos cualesquiera: un inquilino
 * que pagó marzo y junio unos días tarde (y le quedó un saldo chico porque los
 * punitorios se imputan primero, art. 903) no está en esa causal, y citarla
 * empuja una intimación o un desalojo sin sustento.
 *
 * Un período cuenta como impago cuando debe una parte material de su
 * ALQUILER (alquiler + diferencias de ajuste; por defecto, la mitad o más)
 * y ya pasó su vencimiento más los días de gracia. Punitorios, expensas y
 * otros conceptos no cuentan. Pura: la usan el cron y la agenda del resumen.
 */

export interface RentItemLike {
  kind: string;
  amount: number | string;
  paid_amount: number | string;
}

/** Alquiler del período (alquiler + diferencias de ajuste) y lo que falta pagar de él. */
export function rentBalanceOf(items: readonly RentItemLike[]): { rent: number; outstanding: number } {
  let rent = 0;
  let outstanding = 0;
  for (const i of items) {
    if (i.kind !== "alquiler" && i.kind !== "diferencia_ajuste") continue;
    const amount = Number(i.amount) || 0;
    const paid = Number(i.paid_amount) || 0;
    rent += amount;
    outstanding += Math.max(0, amount - paid);
  }
  return { rent: round2(rent), outstanding: round2(outstanding) };
}

export interface ArrearsPeriod {
  kind: string;
  periodIndex: number | null | undefined;
  dueDate: string;
  /** Alquiler del período (ver `rentBalanceOf`). Sin dato, el período no cuenta. */
  rentAmount?: number | null;
  /** Lo que falta pagar de ese alquiler. Sin dato, el período no cuenta. */
  rentOutstanding?: number | null;
}

export interface ArrearsOptions {
  today: string;
  /** Días de gracia del contrato: el período recién cuenta cuando pasaron. */
  graceDays?: number;
  /** Fracción del alquiler impaga desde la que el período cuenta (0,5 = la mitad). */
  minFraction?: number;
}

export const MATERIAL_UNPAID_FRACTION = 0.5;

export function isPeriodUnpaid(p: ArrearsPeriod, opts: ArrearsOptions): boolean {
  if (p.kind !== "mensual" || p.periodIndex == null) return false;
  const rent = Number(p.rentAmount ?? 0);
  const outstanding = Number(p.rentOutstanding ?? 0);
  if (!(rent > 0.005) || !(outstanding > 0.005)) return false;
  // Todavía dentro del plazo (vencimiento + gracia): no es mora.
  if (addDays(p.dueDate, Math.max(0, Math.floor(opts.graceDays ?? 0))) >= opts.today) return false;
  return outstanding >= rent * (opts.minFraction ?? MATERIAL_UNPAID_FRACTION) - 0.005;
}

/**
 * La racha más larga de períodos impagos con número de período consecutivo
 * (la más reciente si hay empate), ordenada por período. Largo ≥ 2 = causal
 * del art. 1219 inc. c.
 */
export function consecutiveUnpaidRun<T extends ArrearsPeriod>(periods: readonly T[], opts: ArrearsOptions): T[] {
  const unpaid = periods
    .filter((p) => isPeriodUnpaid(p, opts))
    .sort((a, b) => Number(a.periodIndex) - Number(b.periodIndex));
  let best: T[] = [];
  let current: T[] = [];
  for (const p of unpaid) {
    const last = current[current.length - 1];
    if (last && Number(p.periodIndex) === Number(last.periodIndex)) continue;
    current = last && Number(p.periodIndex) === Number(last.periodIndex) + 1 ? [...current, p] : [p];
    if (current.length >= best.length) best = current;
  }
  return best;
}
