import { round2 } from "@/lib/finance/booking-economics";
import { addDays, diffDays } from "./ymd";

/**
 * Intereses punitorios por pago fuera de término.
 *
 * La mora es automática (art. 886 CCyC): vencido el plazo, corre el interés
 * pactado desde el día siguiente al vencimiento. Los días de gracia sólo
 * deciden SI se cobra: pagando dentro de la gracia no hay punitorio; pagando
 * después, se cuenta desde el vencimiento (salvo que el contrato diga
 * "desde el fin de la gracia" → `countFrom: "fin_gracia"`).
 *
 * El interés corre sobre el saldo impago de cada día: un pago parcial baja la
 * base desde la fecha en que entra. Un pago del día D cuenta D − vencimiento
 * días de mora (vence el 10, paga el 15 → 5 días).
 */

export type LateFeeType = "diario_pct" | "mensual_pct" | "fijo_diario" | "ninguno";

export interface LateFeeRules {
  type: LateFeeType;
  /** diario_pct: % por día · mensual_pct: % por mes (se prorratea /30) · fijo_diario: monto por día. */
  value: number;
  graceDays: number;
  countFrom?: "vencimiento" | "fin_gracia";
}

export interface BasePayment {
  /** Fecha del pago, YYYY-MM-DD. */
  date: string;
  /** Parte del pago que cancela la base que genera interés (p. ej. el alquiler). */
  amount: number;
}

export interface LateFeeSegment {
  from: string;
  /** Exclusivo: el día del pago (o el corte) no suma interés. */
  to: string;
  days: number;
  base: number;
  amount: number;
}

export interface LateFeeResult {
  /** Días de mora al corte (0 si se pagó/está dentro de la gracia). */
  daysLate: number;
  amount: number;
  segments: LateFeeSegment[];
  /** true si el corte cae dentro de la gracia: todavía no corresponde punitorio. */
  withinGrace: boolean;
}

/**
 * Punitorio acumulado al corte `asOf`: lo que correspondería cobrar si el
 * saldo impago se pagara ese día (vence el 10, corte el 15 → 5 días).
 */
export function computeLateFee(params: {
  dueDate: string;
  asOf: string;
  baseAmount: number;
  payments?: BasePayment[];
  rules: LateFeeRules;
}): LateFeeResult {
  const { dueDate, asOf, baseAmount, rules } = params;
  const empty: LateFeeResult = { daysLate: 0, amount: 0, segments: [], withinGrace: false };
  if (rules.type === "ninguno" || !(rules.value > 0) || !(baseAmount > 0)) return empty;

  const grace = Math.max(0, Math.floor(rules.graceDays || 0));
  const graceEnd = addDays(dueDate, grace);
  const payments = [...(params.payments ?? [])]
    .filter((p) => p.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ¿Se canceló la base dentro de la gracia? Entonces no hay mora.
  let paidByGraceEnd = 0;
  for (const p of payments) if (p.date <= graceEnd) paidByGraceEnd += p.amount;
  if (round2(baseAmount - paidByGraceEnd) <= 0) return empty;
  // Corte dentro de la gracia: todavía no corresponde.
  if (asOf <= graceEnd) return { ...empty, withinGrace: true };

  const startFrom = rules.countFrom === "fin_gracia" ? graceEnd : dueDate;
  const dailyRate =
    rules.type === "diario_pct" ? rules.value / 100 : rules.type === "mensual_pct" ? rules.value / 100 / 30 : 0;

  let outstanding = baseAmount;
  let cursor = startFrom;
  let total = 0;
  const segments: LateFeeSegment[] = [];
  const push = (to: string) => {
    const days = diffDays(cursor, to);
    if (days > 0 && outstanding > 0) {
      const amount = rules.type === "fijo_diario" ? rules.value * days : outstanding * dailyRate * days;
      segments.push({ from: cursor, to, days, base: round2(outstanding), amount: round2(amount) });
      total += amount;
    }
  };
  for (const p of payments) {
    if (p.date <= cursor) {
      outstanding -= p.amount;
      continue;
    }
    if (p.date > asOf) break;
    // Un pago del día D cuenta D − vencimiento días: el tramo termina en D.
    push(p.date);
    cursor = p.date;
    outstanding -= p.amount;
    if (outstanding <= 0.004) break;
  }
  // Saldo impago al corte: si pagara hoy, pagaría asOf − vencimiento días.
  if (outstanding > 0.004 && cursor < asOf) push(asOf);
  const lastPaid = segments.length ? segments[segments.length - 1].to : startFrom;
  return {
    daysLate: Math.max(0, diffDays(startFrom, lastPaid)),
    amount: round2(total),
    segments,
    withinGrace: false,
  };
}

/** Un punitorio ya cargado en un cargo, o la marca en $ 0 de uno condonado. */
export interface BilledLateFee {
  amount: number;
  /** Importe antes de bonificar, si alguien lo bonificó. */
  originalAmount?: number | null;
  /** `meta` del ítem: la condonación al cobrar anota ahí `waived_amount`. */
  meta?: Record<string, unknown> | null;
}

/**
 * Lo condonado que anota la marca de un punitorio perdonado al cobrar (0 si el
 * ítem no es una marca). Condonar no borra la mora: la deja escrita en $ 0
 * para que el próximo cobro del mismo cargo no la vuelva a calcular.
 */
export function waivedAmountOf(meta: Record<string, unknown> | null | undefined): number {
  const v = Number(meta?.waived_amount);
  return Number.isFinite(v) && v > 0 ? round2(v) : 0;
}

/**
 * Punitorio que ya se "facturó" en un cargo: lo cargado antes de cualquier
 * bonificación más lo condonado al cobrar. El punitorio es acumulado (desde el
 * vencimiento), así que cada cobro agrega sólo la diferencia contra esto: nada
 * de lo bonificado o perdonado vuelve a aparecer en el cobro siguiente.
 */
export function lateFeeAlreadyBilled(items: BilledLateFee[]): number {
  return round2(items.reduce((s, i) => s + Number(i.originalAmount ?? i.amount) + waivedAmountOf(i.meta), 0));
}
