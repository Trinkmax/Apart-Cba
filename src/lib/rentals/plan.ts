import type { RentalAdjustment, RentalContract } from "@/lib/types/database";
import {
  computeRentChain,
  rentForPeriod,
  type AdjustmentRules,
  type ChainStep,
  type PeriodRent,
} from "./adjustments";
import { contractTotalValue } from "./entry-costs";
import { indexFrequency, type IndexLookup } from "./indices";
import {
  buildAdjustmentWindows,
  buildSchedule,
  continuationPeriods,
  periodAt,
  type AdjustmentWindow,
  type SchedulePeriod,
} from "./schedule";

/**
 * "Plan" de un contrato: todo lo que se deriva de sus condiciones y de los
 * índices publicados. Es la fuente única que usan la ficha del contrato (línea
 * de tiempo, próximos ajustes), el alta (vista previa), la generación de
 * cargos y el cron. No toca la base.
 */

export type PlanContract = Pick<
  RentalContract,
  | "start_date"
  | "duration_months"
  | "initial_rent"
  | "adjustment_method"
  | "index_code"
  | "adjustment_every_months"
  | "index_lag_months"
  | "fixed_pct"
  | "steps"
  | "rounding"
  | "cap_pct"
  | "allow_decrease"
  | "payment_window_days"
>;

export interface ContractPlan {
  schedule: SchedulePeriod[];
  windows: AdjustmentWindow[];
  chain: ChainStep[];
  rules: AdjustmentRules;
}

export function rulesOf(c: PlanContract): AdjustmentRules {
  return {
    method: c.adjustment_method,
    indexCode: c.index_code,
    fixedPct: c.fixed_pct,
    steps: c.steps,
    rounding: c.rounding,
    capPct: c.cap_pct,
    allowDecrease: c.allow_decrease,
  };
}

/** Ajustes ya aplicados (sequence → monto que rige) a partir de las filas guardadas. */
export function appliedMapOf(
  adjustments: Pick<RentalAdjustment, "sequence" | "status" | "applied_amount">[],
): Map<number, number> {
  const m = new Map<number, number>();
  for (const a of adjustments) {
    if (a.status === "aplicado" && a.applied_amount != null) m.set(a.sequence, Number(a.applied_amount));
  }
  return m;
}

/** Ajustes que se decidió no aplicar. */
export function skippedSetOf(adjustments: Pick<RentalAdjustment, "sequence" | "status">[]): Set<number> {
  return new Set(adjustments.filter((a) => a.status === "omitido").map((a) => a.sequence));
}

export function buildContractPlan(
  c: PlanContract,
  opts: { series?: IndexLookup | null; applied?: ReadonlyMap<number, number>; skipped?: ReadonlySet<number> } = {},
): ContractPlan {
  const every = c.adjustment_method === "sin_ajuste" ? null : c.adjustment_every_months;
  const schedule = buildSchedule({
    startDate: c.start_date,
    durationMonths: c.duration_months,
    adjustmentEveryMonths: every,
    paymentWindowDays: c.payment_window_days,
  });
  const frequency = c.adjustment_method === "indice" && c.index_code ? indexFrequency(c.index_code) : null;
  const windows = buildAdjustmentWindows(schedule, c.start_date, { frequency, lagMonths: c.index_lag_months });
  const rules = rulesOf(c);
  const chain = computeRentChain({
    initialRent: Number(c.initial_rent),
    windows,
    rules,
    series: opts.series ?? null,
    applied: opts.applied,
    skipped: opts.skipped,
  });
  return { schedule, windows, chain, rules };
}

/** Lo que necesita `chargingSchedule` del contrato. */
export type ChargingContract = Pick<RentalContract, "status" | "start_date" | "duration_months" | "payment_window_days"> & {
  continuation_billing?: boolean | null;
};

/**
 * Períodos a FACTURAR que empiezan a más tardar `horizon`: el cronograma del
 * contrato y, si una persona encendió el cobro de la continuación (vencido con
 * el inquilino adentro, art. 1218 CCyC), los meses posteriores al fin. Las
 * continuaciones no pasan por buildAdjustmentWindows: no crean ajustes nuevos
 * y rentForPeriod les da el último precio aplicado. Sin el flag no se factura
 * nada después del fin: un inquilino que se fue sin que nadie cerrara el
 * contrato no acumula deuda fantasma. El corte por salida anticipada
 * (terminated_at) lo sigue haciendo periodsDueForCharging.
 */
export function chargingSchedule(schedule: SchedulePeriod[], c: ChargingContract, horizon: string): SchedulePeriod[] {
  if (c.status !== "vigente" || !c.continuation_billing) return schedule;
  const extra = continuationPeriods(
    { startDate: c.start_date, durationMonths: c.duration_months, adjustmentEveryMonths: null, paymentWindowDays: c.payment_window_days },
    horizon,
  );
  return extra.length ? [...schedule, ...extra] : schedule;
}

/** Precio del período `index` (último conocido + ajuste pendiente si lo hay). */
export function planRentForPeriod(plan: ContractPlan, initialRent: number, periodIndex: number, onlyApplied = false): PeriodRent {
  return rentForPeriod(initialRent, plan.chain, periodIndex, { onlyApplied });
}

/** Alquiler que rige en una fecha (sólo ajustes ya aplicados). null fuera del contrato. */
export function rentInForceOn(plan: ContractPlan, initialRent: number, ymd: string): number | null {
  const p = periodAt(plan.schedule, ymd);
  if (!p) return null;
  return rentForPeriod(initialRent, plan.chain, p.index, { onlyApplied: true }).amount;
}

/** Próximo ajuste que todavía no rige (por fecha), con su estado en la cadena. */
export function nextAdjustment(plan: ContractPlan, today: string): ChainStep | null {
  return plan.chain.find((s) => s.window.effectiveDate > today) ?? null;
}

/** Valor total del contrato a precio de cada período (los desconocidos, al último conocido). */
export function projectedContractTotal(plan: ContractPlan, initialRent: number): number {
  let total = 0;
  for (const p of plan.schedule) total += rentForPeriod(initialRent, plan.chain, p.index).amount;
  return Math.round(total * 100) / 100;
}

/**
 * Escalonado y % fijo: el monto de cada período queda fijado en el contrato
 * desde la firma (escrito, o aritmética sobre el inicial). En índice y manual
 * los precios futuros no se conocen al firmar.
 */
export function hasStipulatedAmounts(method: PlanContract["adjustment_method"]): boolean {
  return method === "escalonado" || method === "porcentaje_fijo";
}

/**
 * Valor del contrato "de acuerdo a los montos estipulados": base del Impuesto
 * de Sellos (art. 276 CTP Córdoba: los alquileres de todo el plazo; el tope de
 * exención del art. 287 inc. 35 mira su promedio mensual) y de los honorarios
 * "% del total del contrato".
 *
 * Con montos pactados (escalonado, % fijo) es la suma de los alquileres de
 * cada período: un 1,0 / 1,2 / 1,4 / 1,6 M promedia 1,3 M, no 1 M, y alquiler
 * inicial × meses lo daba por exento y achicaba los honorarios. El plan se
 * arma sin índices ni montos cargados a mano: cuenta lo que dice el contrato,
 * no lo que pasó después. En el resto es el precio a la firma (alquiler
 * inicial × meses, art. 285 CTP): un contrato por índice cargado con fecha
 * pasada ya tiene ajustes publicados, y no entran.
 */
export function stipulatedContractValue(c: PlanContract): number {
  if (hasStipulatedAmounts(c.adjustment_method)) {
    return projectedContractTotal(buildContractPlan(c), Number(c.initial_rent));
  }
  return contractTotalValue(Number(c.initial_rent), c.duration_months);
}
