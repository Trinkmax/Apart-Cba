import { computeRentChain, type ChainStatus, type RoundingRule } from "@/lib/rentals/adjustments";
import { INDEX_META, indexFrequency, type IndexCode, type IndexLookup } from "@/lib/rentals/indices";
import { buildAdjustmentWindows, buildSchedule, type AdjustmentWindow } from "@/lib/rentals/schedule";
import { contractMonthsElapsed } from "@/lib/rentals/ymd";
import {
  adjustmentWindowLabel,
  formatVariation,
  frequencyLabel,
  longDate,
  plainMoney,
  waitingForIndexText,
} from "@/components/rentals/adjustments/adjustment-text";

/**
 * Calculadora de ajustes (también sirve para cotizar): con un monto, una
 * fecha de inicio (o del último ajuste), el índice, la frecuencia y la
 * convención de meses, encadena TODOS los ajustes hasta el próximo que
 * todavía no rige — con el mismo motor que usan los contratos
 * (`buildSchedule` → `buildAdjustmentWindows` → `computeRentChain`), así el
 * número de la calculadora y el del contrato no pueden diferir.
 */

export interface CalculatorInput {
  amount: number;
  /** Inicio del contrato o fecha del último ajuste (YYYY-MM-DD). */
  startDate: string;
  every: number;
  indexCode: IndexCode;
  /** Sólo índices mensuales: 2 = último dato publicado, 1 = meses del ciclo. */
  lagMonths: number;
  rounding: RoundingRule;
  capPct?: number | null;
  allowDecrease?: boolean;
  today: string;
}

export interface CalculatorStep {
  sequence: number;
  effectiveDate: string;
  fromKey: string | null;
  toKey: string | null;
  fromValue: number | null;
  toValue: number | null;
  coefficient: number | null;
  variationPct: number | null;
  base: number | null;
  amount: number | null;
  status: ChainStatus;
  /** Claves del índice que todavía no se publicaron. */
  missing: string[];
  capped: boolean;
  floored: boolean;
  /** true si ya rige (fecha ≤ hoy). */
  inForce: boolean;
}

export interface CalculatorResult {
  steps: CalculatorStep[];
  /** Precio que rige hoy según el índice (null si algún ajuste vencido no se puede calcular). */
  currentAmount: number;
  /** Primer ajuste que ya debería regir pero no tiene índice (el precio de hoy es provisorio). */
  pendingNow: CalculatorStep | null;
  /** Próximo ajuste (fecha > hoy). */
  next: CalculatorStep | null;
  /** Variación acumulada desde el monto inicial hasta el precio de hoy. */
  totalVariationPct: number | null;
}

/** Meses de cronograma necesarios para llegar al primer ajuste posterior a hoy. */
function horizonMonths(input: CalculatorInput): number {
  const every = Math.max(1, Math.floor(input.every));
  const elapsed = contractMonthsElapsed(input.startDate, input.today);
  const k = elapsed < 0 ? 1 : Math.floor(elapsed / every) + 1;
  return Math.min(k * every + 1, 241);
}

export function calculatorWindows(input: CalculatorInput): AdjustmentWindow[] {
  const schedule = buildSchedule({
    startDate: input.startDate,
    durationMonths: horizonMonths(input),
    adjustmentEveryMonths: input.every,
    paymentWindowDays: 10,
  });
  return buildAdjustmentWindows(schedule, input.startDate, {
    frequency: indexFrequency(input.indexCode),
    lagMonths: input.lagMonths,
  });
}

/** Rango de claves del índice que hay que leer para calcular. */
export function calculatorKeyRange(input: CalculatorInput): [string, string] | null {
  const keys = calculatorWindows(input)
    .flatMap((w) => [w.fromMonth ?? w.fromDate, w.toMonth ?? w.toDate])
    .filter((k): k is string => !!k)
    .sort();
  return keys.length ? [keys[0], keys[keys.length - 1]] : null;
}

export function buildCalculatorPlan(input: CalculatorInput, series: IndexLookup | null): CalculatorResult {
  const chain = computeRentChain({
    initialRent: input.amount,
    windows: calculatorWindows(input),
    rules: {
      method: "indice",
      indexCode: input.indexCode,
      fixedPct: null,
      steps: null,
      rounding: input.rounding,
      capPct: input.capPct ?? null,
      allowDecrease: input.allowDecrease ?? false,
    },
    series,
  });
  const steps: CalculatorStep[] = chain.map((s) => {
    const ok = s.result?.status === "ok" ? s.result : null;
    return {
      sequence: s.window.sequence,
      effectiveDate: s.window.effectiveDate,
      fromKey: s.window.fromMonth ?? s.window.fromDate,
      toKey: s.window.toMonth ?? s.window.toDate,
      fromValue: ok?.fromValue ?? null,
      toValue: ok?.toValue ?? null,
      coefficient: ok?.coefficient ?? null,
      variationPct: ok?.variationPct ?? null,
      base: s.base,
      amount: s.amount,
      status: s.status,
      missing: s.result?.status === "missing_index" ? s.result.missing : [],
      capped: ok?.capped ?? false,
      floored: ok?.floored ?? false,
      inForce: s.window.effectiveDate <= input.today,
    };
  });
  let currentAmount = input.amount;
  let pendingNow: CalculatorStep | null = null;
  for (const s of steps) {
    if (!s.inForce) break;
    if (s.amount == null) {
      pendingNow = s;
      break;
    }
    currentAmount = s.amount;
  }
  const totalVariationPct =
    input.amount > 0 ? Math.round((currentAmount / input.amount - 1) * 10000) / 100 : null;
  return { steps, currentAmount, pendingNow, next: steps.find((s) => !s.inForce) ?? null, totalVariationPct };
}

/** Texto para "Copiar resultado" (WhatsApp, mail o una nota). */
export function calculatorSummaryText(input: CalculatorInput, r: CalculatorResult, currency = "ARS"): string {
  const meta = INDEX_META[input.indexCode];
  const convention =
    indexFrequency(input.indexCode) === "monthly"
      ? input.lagMonths >= 2
        ? " (último dato publicado)"
        : " (meses del ciclo)"
      : "";
  const lines = [
    `Alquiler de ${plainMoney(input.amount, currency)} desde el ${longDate(input.startDate)}, ajuste ${frequencyLabel(input.every)} por ${meta.label}${convention}.`,
  ];
  for (const s of r.steps) {
    const win = adjustmentWindowLabel({ method: "indice", index_code: input.indexCode, from_key: s.fromKey, to_key: s.toKey });
    const when = longDate(s.effectiveDate);
    if (s.amount != null && s.status !== "omitido") {
      lines.push(`- ${when}: ${plainMoney(s.amount, currency)} (${formatVariation(s.variationPct)}${win ? `, ${win}` : ""})`);
    } else if (s.status === "pendiente_indice") {
      lines.push(`- ${when}: ${waitingForIndexText(input.indexCode, s.missing[s.missing.length - 1] ?? s.toKey)}`);
    } else {
      lines.push(`- ${when}: se calcula cuando salga el ajuste anterior.`);
    }
  }
  lines.push(
    r.pendingNow
      ? `Hoy rige ${plainMoney(r.currentAmount, currency)} (provisorio: falta el índice del ajuste del ${longDate(r.pendingNow.effectiveDate)}).`
      : `Hoy rige ${plainMoney(r.currentAmount, currency)}${r.totalVariationPct ? ` (${formatVariation(r.totalVariationPct)} desde el inicio)` : ""}.`,
  );
  return lines.join("\n");
}
