import { round2 } from "@/lib/finance/booking-economics";
import type { RentalChargeItemKind, RentalPayee } from "@/lib/types/database";
import type { PeriodRent } from "./adjustments";
import { chargeLabel, monthLabelOf } from "./labels";
import type { SchedulePeriod } from "./schedule";
import { addDays } from "./ymd";

/**
 * Composición de los cargos al inquilino.
 *
 * Un cargo mensual = el alquiler del período (+ expensas si las cobra la
 * inmobiliaria, + cuotas de honorarios, + gastos que se le trasladan). Se
 * genera `leadDays` antes de que empiece el período, una sola vez por período
 * (la base lo garantiza con un índice único).
 */

export interface ChargeItemDraft {
  kind: RentalChargeItemKind;
  payee: RentalPayee;
  description: string;
  amount: number;
  /** Importe antes de bonificar (sólo un ítem que pasa de un cargo anulado). */
  original_amount?: number | null;
  discount_reason?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  meta?: Record<string, unknown>;
  sort_order?: number;
}

export interface MonthlyChargeDraft {
  kind: "mensual";
  period_index: number;
  period_start: string;
  period_end: string;
  /** null en un mes de continuación (art. 1218): no pertenece a ningún ciclo de ajuste. */
  cycle: number | null;
  index_in_cycle: number | null;
  cycle_length: number | null;
  label: string;
  due_date: string;
  currency: string;
  pending_adjustment_seq: number | null;
  items: ChargeItemDraft[];
}

export function buildMonthlyCharge(params: {
  period: SchedulePeriod;
  rent: PeriodRent;
  currency: string;
  expensas?: { amount: number; label?: string } | null;
  extraItems?: ChargeItemDraft[];
  /** Lo que pasa del mensual anulado del mismo mes (carryOverItems): va tal cual, aunque sea una marca en $ 0. */
  carriedItems?: ChargeItemDraft[];
}): MonthlyChargeDraft {
  const { period, rent } = params;
  const label = period.continuation
    ? `${monthLabelOf(period.start)} · Continuación`
    : chargeLabel(period.start, period.indexInCycle, period.cycleLength);
  const items: ChargeItemDraft[] = [
    {
      kind: "alquiler",
      payee: "propietario",
      description: period.continuation
        ? `Alquiler ${monthLabelOf(period.start)} (continuación, art. 1218 CCyC)`
        : `Alquiler ${label}`,
      amount: round2(rent.amount),
      meta: {
        period_index: period.index,
        from_sequence: rent.fromSequence,
        pending_sequence: rent.pendingSequence,
        // Lo que el motor facturó como alquiler del período. Es la base para
        // detectar ajustes corregidos después: una bonificación manual baja
        // `amount` pero no toca esto, así la reconciliación no la deshace.
        billed_rent: round2(rent.amount),
      },
      sort_order: 0,
    },
  ];
  if (params.expensas && params.expensas.amount > 0) {
    items.push({
      kind: "expensas",
      payee: "consorcio",
      description: params.expensas.label ?? `Expensas ${monthLabelOf(period.start)}`,
      amount: round2(params.expensas.amount),
      sort_order: 10,
    });
  }
  for (const x of params.extraItems ?? []) {
    if (x.amount > 0) items.push({ ...x, amount: round2(x.amount), sort_order: x.sort_order ?? 20 });
  }
  for (const x of params.carriedItems ?? []) items.push({ ...x, amount: round2(x.amount), sort_order: x.sort_order ?? 20 });
  return {
    kind: "mensual",
    period_index: period.index,
    period_start: period.start,
    period_end: period.end,
    cycle: period.continuation ? null : period.cycle,
    index_in_cycle: period.continuation ? null : period.indexInCycle,
    cycle_length: period.continuation ? null : period.cycleLength,
    label,
    due_date: period.dueDate,
    currency: params.currency,
    pending_adjustment_seq: rent.pendingSequence,
    items,
  };
}

// ─── Lo que pasa de un mensual anulado al que lo reemplaza ──────────────────

/** Un ítem de un cargo mensual anulado, como se lee de la base. */
export interface VoidedChargeItem {
  id: string;
  kind: RentalChargeItemKind;
  payee: RentalPayee;
  description: string;
  amount: number;
  original_amount: number | null;
  discount_reason: string | null;
  ref_type: string | null;
  ref_id: string | null;
  meta: Record<string, unknown> | null;
  sort_order: number;
}

/** Un mensual anulado que puede ceder sus ítems al cargo nuevo del mismo mes. */
export interface VoidedMonthlyCharge {
  id: string;
  period_start: string | null;
  currency: string;
  voided_at: string | null;
  items: VoidedChargeItem[];
}

/**
 * Lo que el motor rehace solo al volver a generar un mensual: el alquiler (sale
 * del contrato), las diferencias por ajuste (las recalcula la reconciliación) y
 * los gastos trasladados (al anular vuelven a "pendiente" y entran en el
 * próximo cargo). Todo lo demás lo cargó una persona o un cobro.
 */
export function isEngineItem(item: Pick<VoidedChargeItem, "kind" | "ref_type">): boolean {
  return item.kind === "alquiler" || item.kind === "diferencia_ajuste" || item.ref_type === "rental_expense";
}

/**
 * De qué mensual anulado salen los ítems del cargo nuevo: el último que se
 * anuló para el mismo mes y en la misma moneda. El mes (no el número de
 * período) es lo que identifica las expensas o la reparación de "octubre",
 * aunque haya cambiado la fecha de inicio. Sólo el último: lo que tenía uno
 * anterior ya pasó a éste cuando se generó, así que nada se copia dos veces.
 * En otra moneda no se pasa nada (un importe en pesos no vale lo mismo en dólares).
 */
export function pickCarrySource(
  voided: readonly VoidedMonthlyCharge[],
  periodStart: string,
  currency: string,
): VoidedMonthlyCharge | null {
  const month = periodStart.slice(0, 7);
  const sameMonth = voided
    .filter((c) => c.period_start?.slice(0, 7) === month)
    .sort((a, b) => (b.voided_at ?? "").localeCompare(a.voided_at ?? ""));
  const latest = sameMonth[0];
  return latest && latest.currency === currency ? latest : null;
}

/**
 * Ítems de un mensual anulado que pasan al cargo que lo reemplaza: expensas,
 * conceptos agregados a mano, punitorios y las marcas en $ 0 de lo condonado,
 * con su importe, su bonificación y su `meta` (así el punitorio ya facturado o
 * perdonado no se vuelve a calcular en el próximo cobro). `carried_from` deja
 * el rastro del ítem original. No pasa lo que el motor rehace (isEngineItem).
 */
export function carryOverItems(items: readonly VoidedChargeItem[]): ChargeItemDraft[] {
  return items
    .filter((i) => !isEngineItem(i))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({
      kind: i.kind,
      payee: i.payee,
      description: i.description,
      amount: round2(Number(i.amount)),
      original_amount: i.original_amount == null ? null : round2(Number(i.original_amount)),
      discount_reason: i.discount_reason,
      ref_type: i.ref_type,
      ref_id: i.ref_id,
      meta: { ...(i.meta ?? {}), carried_from: i.id },
      sort_order: i.sort_order,
    }));
}

/**
 * ¿Algún período a facturar del cronograma empieza en ese mes? Mismos cortes
 * que periodsDueForCharging (inicio de la cobranza y salida), sin el horizonte:
 * dice si lo de un mensual anulado de ese mes todavía tiene adónde pasar.
 */
export function monthIsBillable(
  schedule: readonly SchedulePeriod[],
  month: string,
  opts: { billingStartsOn?: string | null; terminatedAt?: string | null },
): boolean {
  const key = month.slice(0, 7);
  return schedule.some(
    (p) =>
      p.start.slice(0, 7) === key &&
      !(opts.billingStartsOn && p.end < opts.billingStartsOn) &&
      !(opts.terminatedAt && p.start > opts.terminatedAt),
  );
}

/**
 * Bonificación hecha a mano sobre el alquiler de un mensual. No pasa al cargo
 * nuevo (el alquiler sale del contrato y anular es la forma de deshacer una
 * bonificación equivocada): se avisa para que una persona la vuelva a hacer.
 */
export function rentDiscountOf(items: readonly Pick<VoidedChargeItem, "kind" | "amount" | "original_amount">[]): number {
  return round2(
    items
      .filter((i) => i.kind === "alquiler" && i.original_amount != null)
      .reduce((s, i) => s + Math.max(0, Number(i.original_amount) - Number(i.amount)), 0),
  );
}

/**
 * Períodos a los que ya les toca su cargo y todavía no lo tienen: empezaron o
 * empiezan dentro de `leadDays`, no son anteriores al inicio de la cobranza
 * (contratos que ya venían corriendo) ni posteriores al fin anticipado.
 */
export function periodsDueForCharging(
  schedule: SchedulePeriod[],
  opts: {
    today: string;
    leadDays: number;
    billingStartsOn?: string | null;
    terminatedAt?: string | null;
    existing: ReadonlySet<number>;
  },
): SchedulePeriod[] {
  const horizon = addDays(opts.today, Math.max(0, opts.leadDays));
  return schedule.filter((p) => {
    if (opts.existing.has(p.index)) return false;
    if (p.start > horizon) return false;
    if (opts.billingStartsOn && p.end < opts.billingStartsOn) return false;
    if (opts.terminatedAt && p.start > opts.terminatedAt) return false;
    return true;
  });
}

export interface BilledRent {
  chargeId: string;
  periodIndex: number;
  /** Lo facturado como alquiler en ese cargo (alquiler + diferencias ya agregadas). */
  billed: number;
  /** El cargo está pagado del todo: la diferencia va a un cargo nuevo, no a éste. */
  settled: boolean;
}

export interface AdjustmentDifference {
  chargeId: string;
  periodIndex: number;
  amount: number;
}

/**
 * Cargos que salieron con un precio viejo (el ajuste no tenía índice todavía)
 * y ahora deben la diferencia. Sólo diferencias positivas: si el precio
 * corregido es menor, lo decide una persona (bonificación).
 */
export function adjustmentDifferences(
  billed: BilledRent[],
  expectedRentFor: (periodIndex: number) => number | null,
): AdjustmentDifference[] {
  const out: AdjustmentDifference[] = [];
  for (const b of billed) {
    const expected = expectedRentFor(b.periodIndex);
    if (expected == null) continue;
    const diff = round2(expected - b.billed);
    if (diff > 0.009) out.push({ chargeId: b.chargeId, periodIndex: b.periodIndex, amount: diff });
  }
  return out;
}

/** Un cargo candidato a recibir la diferencia de un ajuste. */
export interface DifferenceTargetCandidate {
  id: string;
  kind: string;
  status: string;
  due_date: string;
  period_start: string | null;
}

/** Días mínimos entre que aparece una diferencia y el vencimiento del cargo que la cobra. */
export const DIFFERENCE_MIN_NOTICE_DAYS = 3;

/**
 * Dónde va la "Diferencia por ajuste" de un período que salió con el precio
 * viejo. Nunca a un cargo vencido (o que vence en menos de `minNoticeDays`):
 * los punitorios corren desde el vencimiento del cargo que la contiene, y no
 * corresponde cobrarle mora al inquilino por días en los que la diferencia ni
 * se conocía (con desfasaje 1 el índice sale después del día 10). Tampoco a un
 * cargo que no sea mensual ni a uno de un mes posterior a la salida (se anula
 * al cerrar el contrato y la diferencia se perdería con él).
 * Orden: el cargo del propio período; si no, el mensual abierto que vence
 * más tarde; si no, null → cargo aparte, con su propio vencimiento.
 */
export function chooseDifferenceTarget(
  source: DifferenceTargetCandidate,
  candidates: readonly DifferenceTargetCandidate[],
  opts: { today: string; terminatedAt?: string | null; minNoticeDays?: number },
): string | null {
  const earliestDue = addDays(opts.today, Math.max(0, opts.minNoticeDays ?? DIFFERENCE_MIN_NOTICE_DAYS));
  const eligible = (r: DifferenceTargetCandidate) =>
    r.kind === "mensual" &&
    (r.status === "pendiente" || r.status === "parcial") &&
    r.due_date >= earliestDue &&
    !(opts.terminatedAt && r.period_start && r.period_start > opts.terminatedAt);
  if (eligible(source)) return source.id;
  const latest = candidates.filter(eligible).sort((a, b) => b.due_date.localeCompare(a.due_date))[0];
  return latest?.id ?? null;
}
