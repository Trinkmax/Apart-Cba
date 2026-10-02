import { round2 } from "@/lib/finance/booking-economics";
import type { ChainStep } from "@/lib/rentals/adjustments";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import { MONTHS } from "@/lib/settlements/labels";
import type { RentalAdjustment, RentalAdjustmentMethod, RentalAdjustmentStatus, RentalIndexCode } from "@/lib/types/database";

/**
 * Vista de los ajustes de un contrato para la UI (pura, server + client).
 *
 * El motor (`buildContractPlan`) dice qué DEBERÍA pasar con los índices
 * publicados; las filas de `rental_adjustments` dicen qué pasó de verdad
 * (aplicado a mano, corregido, omitido, auto-aplicado por el cron). Para
 * mostrar, mandan las filas; la cadena completa los ajustes que todavía no
 * tienen fila (borradores, vista previa del alta).
 */

export interface TimelineAdjustment {
  sequence: number;
  periodIndex: number;
  /** Desde cuándo rige el precio nuevo. */
  effectiveDate: string;
  status: RentalAdjustmentStatus;
  /** Precio desde este ajuste (aplicado, o el calculado si todavía no se aplicó). null = todavía no se sabe. */
  amount: number | null;
  /** Precio que regía antes. */
  base: number | null;
  /** Variación del PRECIO (lo que paga el inquilino), no la del índice crudo. */
  variationPct: number | null;
  /** Claves del índice usadas (YYYY-MM-01 o YYYY-MM-DD). */
  fromKey: string | null;
  toKey: string | null;
  /** El monto aplicado difiere del cálculo (corrección a mano). */
  overridden: boolean;
  overrideReason: string | null;
  notifiedAt: string | null;
}

export type AdjustmentRow = Pick<
  RentalAdjustment,
  | "sequence"
  | "period_index"
  | "effective_date"
  | "status"
  | "from_key"
  | "to_key"
  | "variation_pct"
  | "base_amount"
  | "computed_amount"
  | "applied_amount"
  | "override_reason"
  | "notified_at"
>;

/** Estado "guardado" equivalente de un paso de la cadena que todavía no tiene fila. */
export function statusFromChain(step: ChainStep, today: string): RentalAdjustmentStatus {
  switch (step.status) {
    case "aplicado":
      return "aplicado";
    case "omitido":
      return "omitido";
    case "calculado":
      return "calculado";
    case "pendiente_indice":
      return step.window.effectiveDate <= today ? "pendiente_indice" : "programado";
    case "pendiente_manual":
    case "invalido":
      return "pendiente_manual";
    default:
      return "programado";
  }
}

function priceVariation(amount: number | null, base: number | null): number | null {
  if (amount == null || base == null || !(base > 0)) return null;
  return round2((amount / base - 1) * 100);
}

export function mergeAdjustments(chain: ChainStep[], rows: AdjustmentRow[] | null | undefined, today: string): TimelineAdjustment[] {
  const bySeq = new Map((rows ?? []).map((r) => [r.sequence, r]));
  return chain.map((step) => {
    const row = bySeq.get(step.window.sequence);
    const calc = step.result?.status === "ok" ? step.result : null;
    if (row) {
      const amount = row.applied_amount != null ? Number(row.applied_amount) : row.computed_amount != null ? Number(row.computed_amount) : step.amount;
      const base = row.base_amount != null ? Number(row.base_amount) : step.base;
      const overridden =
        row.status === "aplicado" &&
        row.applied_amount != null &&
        (Boolean(row.override_reason) || (row.computed_amount != null && Math.abs(Number(row.applied_amount) - Number(row.computed_amount)) > 0.004));
      return {
        sequence: step.window.sequence,
        periodIndex: row.period_index ?? step.window.periodIndex,
        effectiveDate: row.effective_date ?? step.window.effectiveDate,
        status: row.status,
        amount: row.status === "omitido" ? base : amount,
        base,
        variationPct: row.status === "omitido" ? 0 : (priceVariation(amount, base) ?? (row.variation_pct != null ? Number(row.variation_pct) : null)),
        fromKey: row.from_key ?? step.window.fromMonth ?? step.window.fromDate,
        toKey: row.to_key ?? step.window.toMonth ?? step.window.toDate,
        overridden,
        overrideReason: row.override_reason,
        notifiedAt: row.notified_at,
      };
    }
    return {
      sequence: step.window.sequence,
      periodIndex: step.window.periodIndex,
      effectiveDate: step.window.effectiveDate,
      status: statusFromChain(step, today),
      amount: step.amount,
      base: step.base,
      variationPct: priceVariation(step.amount, step.base) ?? calc?.variationPct ?? null,
      fromKey: step.window.fromMonth ?? step.window.fromDate,
      toKey: step.window.toMonth ?? step.window.toDate,
      overridden: false,
      overrideReason: null,
      notifiedAt: null,
    };
  });
}

// ─── Textos ─────────────────────────────────────────────────────────────────

const FREQUENCY_WORD: Record<number, string> = {
  1: "mensual",
  2: "bimestral",
  3: "trimestral",
  4: "cuatrimestral",
  6: "semestral",
  12: "anual",
};

/** 3 → "trimestral", 5 → "cada 5 meses". */
export function frequencyLabel(every: number | null | undefined): string {
  if (!every || every < 1) return "sin ajuste";
  return FREQUENCY_WORD[every] ?? `cada ${every} meses`;
}

/** "+8,7 %" (signo explícito, coma decimal). */
export function pctLabel(pct: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const abs = Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: Math.abs(pct) < 10 ? 2 : 1 });
  const sign = opts.signed === false ? (pct < 0 ? "−" : "") : pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${abs} %`;
}

/** Resumen corto del método: "IPC · trimestral", "10 % · semestral", "Sin ajuste". */
export function adjustmentSummary(c: {
  adjustment_method: RentalAdjustmentMethod;
  index_code: RentalIndexCode | null;
  adjustment_every_months: number | null;
  fixed_pct?: number | null;
}): string {
  const freq = frequencyLabel(c.adjustment_every_months);
  switch (c.adjustment_method) {
    case "sin_ajuste":
      return "Sin ajuste";
    case "indice":
      return `${c.index_code && isIndexCode(c.index_code) ? INDEX_META[c.index_code].label : "Índice"} · ${freq}`;
    case "porcentaje_fijo":
      return `${c.fixed_pct != null ? pctLabel(Number(c.fixed_pct), { signed: false }) : "% fijo"} · ${freq}`;
    case "escalonado":
      return `Escalonado · ${freq}`;
    case "manual":
      return `A mano · ${freq}`;
  }
}

const MONTHS_LOWER = MONTHS.map((m) => m.toLowerCase());

/** "feb 2026" para claves mensuales, "15/03/2026" para diarias. */
export function indexKeyLabel(key: string | null | undefined, frequency: "monthly" | "daily" = "monthly"): string {
  if (!key) return "—";
  if (frequency === "daily") return key.split("-").reverse().join("/");
  const m = Number(key.slice(5, 7));
  return `${(MONTHS_LOWER[m - 1] ?? "?").slice(0, 3)} ${key.slice(0, 4)}`;
}

/** Meses (1-12) que entran en un ajuste mensual que rige desde `effectiveMonth`. */
export function monthsUsed(effectiveMonth: number, every: number, lag: number): number[] {
  const out: number[] = [];
  for (let k = every - 1; k >= 0; k--) {
    const m = (((effectiveMonth - lag - k - 1) % 12) + 12) % 12;
    out.push(m + 1);
  }
  return out;
}

function joinEs(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}`;
}

/**
 * Ejemplo concreto de la convención de meses: "Para el ajuste de junio se usa
 * la inflación de febrero, marzo y abril". `effectiveMonth` 1-12.
 */
export function lagExample(params: { effectiveMonth: number; every: number; lag: number; indexLabel?: string }): string {
  const every = Math.max(1, Math.floor(params.every));
  const months = monthsUsed(params.effectiveMonth, every, params.lag).map((m) => MONTHS_LOWER[m - 1]);
  const target = MONTHS_LOWER[params.effectiveMonth - 1];
  const what = params.indexLabel && params.indexLabel !== "IPC" ? `la variación del ${params.indexLabel}` : "la inflación";
  const list = every <= 4 ? joinEs(months) : `los ${every} meses de ${months[0]} a ${months[months.length - 1]}`;
  return `Para el ajuste de ${target} se usa ${what} de ${list}.`;
}
