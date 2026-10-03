import { round2 } from "@/lib/finance/booking-economics";
import { lookupWindow, type IndexCode, type IndexLookup } from "./indices";
import type { AdjustmentWindow } from "./schedule";

/**
 * Motor de actualización del precio de un contrato.
 *
 * Métodos:
 *   indice           → nuevo = base × nivel(fin) / nivel(inicio) del índice.
 *   porcentaje_fijo  → nuevo = base × (1 + pct/100) en cada ajuste.
 *   escalonado       → montos pactados de antemano para cada ajuste.
 *   manual           → alguien carga el monto nuevo en cada ajuste.
 *   sin_ajuste       → precio fijo todo el contrato.
 *
 * Después del cociente se aplican, en este orden: tope por ajuste (si hay),
 * piso (el precio no baja salvo que el contrato lo permita) y redondeo. El
 * monto redondeado es el que se cobra y la base del ajuste siguiente.
 */

/**
 * Con "aplicar automáticamente", un ajuste calculado se aplica recién cuando
 * faltan como mucho estos días para que rija: alcanza para generar el cargo
 * del período (se genera hasta 28 días antes) y para avisarle al inquilino con
 * un mes de anticipación, sin dar por aplicados ajustes de dentro de un año
 * (los de % fijo o escalonados se conocen desde el primer día). Antes de ese
 * horizonte un ajuste calculado no pide nada: no cuenta como "para resolver".
 */
export const AUTO_APPLY_HORIZON_DAYS = 35;

export type AdjustmentMethod = "indice" | "porcentaje_fijo" | "escalonado" | "manual" | "sin_ajuste";

export type RoundingRule = "none" | "unit" | "ten" | "hundred" | "thousand";

const ROUNDING_STEP: Record<RoundingRule, number> = {
  none: 0,
  unit: 1,
  ten: 10,
  hundred: 100,
  thousand: 1000,
};

/** Redondeo al múltiplo más cercano (la mitad sube). "none" deja centavos. */
export function roundAmount(amount: number, rule: RoundingRule): number {
  const step = ROUNDING_STEP[rule] ?? 0;
  if (!step) return round2(amount);
  return round2(Math.round(round2(amount) / step) * step);
}

export interface AdjustmentRules {
  method: AdjustmentMethod;
  indexCode: IndexCode | null;
  /** porcentaje_fijo: % de cada ajuste (10 = +10 %). */
  fixedPct: number | null;
  /** escalonado: monto de cada ajuste, en orden (posición 0 = ajuste 1). */
  steps: number[] | null;
  rounding: RoundingRule;
  /** Tope de aumento por ajuste, en %. null = sin tope. */
  capPct: number | null;
  /** false (lo habitual): si el índice baja, el precio queda igual. */
  allowDecrease: boolean;
}

export type AdjustmentResult =
  | {
      status: "ok";
      /** Cociente aplicado, ya con tope/piso. */
      coefficient: number;
      /** Cociente crudo del índice o del % (antes de tope/piso). */
      rawCoefficient: number;
      /** (coeficiente − 1) × 100, con 2 decimales. */
      variationPct: number;
      amountBeforeRounding: number;
      amount: number;
      fromValue: number | null;
      toValue: number | null;
      capped: boolean;
      floored: boolean;
    }
  /** El dato del índice todavía no se publicó (o falta en la serie). */
  | { status: "missing_index"; missing: string[] }
  /** Método manual, o escalonado sin monto para este ajuste. */
  | { status: "needs_manual" }
  /** Configuración inválida (p. ej. índice sin código). */
  | { status: "invalid"; reason: string };

function finish(
  base: number,
  rawCoefficient: number,
  rules: AdjustmentRules,
  fromValue: number | null,
  toValue: number | null,
): AdjustmentResult {
  let coefficient = rawCoefficient;
  let capped = false;
  let floored = false;
  if (rules.capPct != null && Number.isFinite(rules.capPct) && coefficient > 1 + rules.capPct / 100) {
    coefficient = 1 + rules.capPct / 100;
    capped = true;
  }
  if (!rules.allowDecrease && coefficient < 1) {
    coefficient = 1;
    floored = true;
  }
  const amountBeforeRounding = round2(base * coefficient);
  return {
    status: "ok",
    coefficient,
    rawCoefficient,
    variationPct: round2((coefficient - 1) * 100),
    amountBeforeRounding,
    amount: roundAmount(amountBeforeRounding, rules.rounding),
    fromValue,
    toValue,
    capped,
    floored,
  };
}

/** Calcula UN ajuste a partir del precio vigente (`base`). */
export function computeAdjustment(
  base: number,
  window: AdjustmentWindow,
  rules: AdjustmentRules,
  series?: IndexLookup | null,
): AdjustmentResult {
  switch (rules.method) {
    case "sin_ajuste":
      // El precio queda tal cual: ni tope, ni piso, ni redondeo.
      return {
        status: "ok",
        coefficient: 1,
        rawCoefficient: 1,
        variationPct: 0,
        amountBeforeRounding: round2(base),
        amount: round2(base),
        fromValue: null,
        toValue: null,
        capped: false,
        floored: false,
      };
    case "manual":
      return { status: "needs_manual" };
    case "escalonado": {
      const step = rules.steps?.[window.sequence - 1];
      if (step == null || !Number.isFinite(step) || step <= 0) return { status: "needs_manual" };
      // El monto pactado se respeta tal cual: sin tope, piso ni redondeo.
      const amount = round2(step);
      const coefficient = base > 0 ? amount / base : 1;
      return {
        status: "ok",
        coefficient,
        rawCoefficient: coefficient,
        variationPct: round2((coefficient - 1) * 100),
        amountBeforeRounding: amount,
        amount,
        fromValue: null,
        toValue: null,
        capped: false,
        floored: false,
      };
    }
    case "porcentaje_fijo": {
      if (rules.fixedPct == null || !Number.isFinite(rules.fixedPct)) {
        return { status: "invalid", reason: "Falta el porcentaje de cada ajuste." };
      }
      return finish(base, 1 + rules.fixedPct / 100, rules, null, null);
    }
    case "indice": {
      if (!rules.indexCode) return { status: "invalid", reason: "Falta elegir el índice." };
      const fromKey = window.fromMonth ?? window.fromDate;
      const toKey = window.toMonth ?? window.toDate;
      if (!fromKey || !toKey) return { status: "invalid", reason: "La ventana del ajuste no tiene fechas." };
      // En Casa Propia (coeficientes encadenados) las dos puntas tienen que caer
      // en el mismo tramo sin huecos: un mes faltante antes o después de la
      // ventana no la frena. En los índices de nivel es get() de cada punta.
      const pair = lookupWindow(series, fromKey, toKey);
      if (!pair.ok) return { status: "missing_index", missing: pair.missing };
      return finish(base, pair.toValue / pair.fromValue, rules, pair.fromValue, pair.toValue);
    }
  }
}

export type ChainStatus =
  /** Ya aplicado: el monto es lo que de verdad se cobra (puede diferir del cálculo). */
  | "aplicado"
  /** Calculado con datos publicados, falta confirmarlo. */
  | "calculado"
  /** No hay dato del índice todavía. */
  | "pendiente_indice"
  /** Requiere que alguien cargue el monto. */
  | "pendiente_manual"
  /** Un ajuste anterior sigue pendiente: no se puede calcular éste. */
  | "bloqueado"
  /** Se decidió no aplicarlo: el precio sigue igual y la cadena continúa desde ahí. */
  | "omitido"
  | "invalido";

export interface ChainStep {
  window: AdjustmentWindow;
  /** Precio vigente antes de este ajuste (null si un ajuste previo está pendiente). */
  base: number | null;
  result: AdjustmentResult | null;
  /** Precio desde este ajuste: el aplicado si lo hay, si no el calculado. */
  amount: number | null;
  status: ChainStatus;
}

/**
 * Encadena todos los ajustes del contrato. `applied` trae los montos ya
 * aplicados (sequence → monto): mandan sobre el cálculo, porque son lo que el
 * inquilino efectivamente paga y la base del ajuste siguiente.
 */
export function computeRentChain(params: {
  initialRent: number;
  windows: AdjustmentWindow[];
  rules: AdjustmentRules;
  series?: IndexLookup | null;
  applied?: ReadonlyMap<number, number>;
  /** Ajustes que se decidió no aplicar (sequence). */
  skipped?: ReadonlySet<number>;
}): ChainStep[] {
  const steps: ChainStep[] = [];
  let base: number | null = params.initialRent;
  for (const w of params.windows) {
    if (params.skipped?.has(w.sequence) && base != null) {
      steps.push({ window: w, base, result: null, amount: base, status: "omitido" });
      continue;
    }
    const appliedAmount = params.applied?.get(w.sequence);
    const result: AdjustmentResult | null =
      base != null ? computeAdjustment(base, w, params.rules, params.series) : null;
    if (appliedAmount != null) {
      steps.push({ window: w, base, result, amount: appliedAmount, status: "aplicado" });
      base = appliedAmount;
      continue;
    }
    if (base == null || !result) {
      steps.push({ window: w, base: null, result: null, amount: null, status: "bloqueado" });
      continue;
    }
    if (result.status === "ok") {
      steps.push({ window: w, base, result, amount: result.amount, status: "calculado" });
      base = result.amount;
    } else {
      const status: ChainStatus =
        result.status === "missing_index"
          ? "pendiente_indice"
          : result.status === "needs_manual"
            ? "pendiente_manual"
            : "invalido";
      steps.push({ window: w, base, result, amount: null, status });
      base = null;
    }
  }
  return steps;
}

export interface PeriodRent {
  /** Último precio conocido que rige en el período. */
  amount: number;
  /** Ajuste que fijó ese precio (null = precio inicial). */
  fromSequence: number | null;
  /** Ajuste que ya debería regir en este período pero todavía no tiene monto. */
  pendingSequence: number | null;
}

/**
 * Precio a cobrar en un período. Si el ajuste que corresponde todavía no se
 * puede calcular, se cobra el último precio conocido y se marca el pendiente:
 * cuando salga el índice, la diferencia se cobra aparte ("diferencia de ajuste").
 */
export function rentForPeriod(
  initialRent: number,
  chain: ChainStep[],
  periodIndex: number,
  opts: { onlyApplied?: boolean } = {},
): PeriodRent {
  let amount = initialRent;
  let fromSequence: number | null = null;
  let pendingSequence: number | null = null;
  for (const step of chain) {
    if (step.window.periodIndex > periodIndex) break;
    const usable = opts.onlyApplied
      ? step.status === "aplicado" || step.status === "omitido"
      : step.amount != null;
    if (usable && step.amount != null) {
      amount = step.amount;
      fromSequence = step.window.sequence;
      pendingSequence = null;
    } else if (pendingSequence == null) {
      pendingSequence = step.window.sequence;
    }
  }
  return { amount, fromSequence, pendingSequence };
}
