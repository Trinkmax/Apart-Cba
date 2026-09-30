import type { UnitDefaultMode, UnitPricingRule } from "@/lib/types/database";
import { DAYS_PER_MONTH } from "@/lib/units/pricing";
import { computePricing, countNights, type PricingBreakdown } from "./pricing";
import { roundMoney } from "./sena";

/**
 * Estadías por noche vs. por mes en la web.
 *
 * Desde 28 noches una estadía es "por mes": se cotiza con el precio mensual de
 * lista (units.monthly_price, renta ÷ 30 × noches, la misma cuenta que el PMS
 * usa para los tramos mensuales — migración 054) y se CONSULTA con el equipo
 * (contrato, depósito en garantía, forma de pago). Nunca se inventa un mensual
 * multiplicando la noche × 30: las rentas reales salen 11–21 veces la noche,
 * así que noche × 30 mostraba el doble.
 */

export const MONTHLY_STAY_MIN_NIGHTS = 28;

type StayUnit = {
  default_mode: UnitDefaultMode | string | null | undefined;
  min_nights: number | null | undefined;
};

export function isMonthlyStay(nights: number): boolean {
  return Number.isFinite(nights) && nights >= MONTHLY_STAY_MIN_NIGHTS;
}

/**
 * La unidad acepta estadías cortas (pestaña "Por noche"): no es de vocación
 * mensual y su estadía mínima es menor a 28 noches. Una temporaria con mínimo
 * de 30 noches es, en los hechos, mensual.
 */
export function offersShortStays(unit: StayUnit): boolean {
  const min = Number(unit.min_nights ?? 1);
  return unit.default_mode !== "mensual" && min < MONTHLY_STAY_MIN_NIGHTS;
}

/**
 * La unidad acepta estadías por mes (pestaña "Por mes"): es mensual o mixta,
 * o su estadía mínima ya es de 28+ noches.
 */
export function offersMonthlyStays(unit: StayUnit): boolean {
  const min = Number(unit.min_nights ?? 1);
  return unit.default_mode !== "temporario" || min >= MONTHLY_STAY_MIN_NIGHTS;
}

export type StayQuote =
  | {
      kind: "nightly";
      nights: number;
      subtotal: number;
      cleaningFee: number;
      total: number;
      avgNightly: number;
      breakdown: PricingBreakdown;
    }
  | {
      kind: "monthly";
      nights: number;
      /** Precio de lista por mes; null = no cargado (se consulta). */
      monthlyPrice: number | null;
      /** Estimado de la estadía (mes ÷ 30 × noches); null sin precio mensual. */
      estimatedTotal: number | null;
    };

/**
 * Cotiza una estadía [checkIn, checkOut). Menos de 28 noches → por noche con
 * las reglas de precio (igual que el checkout). 28 o más → por mes.
 */
export function quoteStay(params: {
  checkInIso: string;
  checkOutIso: string;
  basePrice: number;
  cleaningFee: number | null;
  monthlyPrice: number | null;
  pricingRules: UnitPricingRule[];
  currency?: string;
}): StayQuote {
  const nights = countNights(params.checkInIso, params.checkOutIso);
  if (isMonthlyStay(nights)) {
    const monthly =
      params.monthlyPrice != null && Number.isFinite(params.monthlyPrice) && params.monthlyPrice > 0
        ? params.monthlyPrice
        : null;
    return {
      kind: "monthly",
      nights,
      monthlyPrice: monthly,
      estimatedTotal:
        monthly != null
          ? roundMoney((monthly / DAYS_PER_MONTH) * nights, params.currency ?? "ARS")
          : null,
    };
  }
  const breakdown = computePricing({
    checkInIso: params.checkInIso,
    checkOutIso: params.checkOutIso,
    basePrice: params.basePrice,
    cleaningFee: params.cleaningFee,
    rules: params.pricingRules,
  });
  return {
    kind: "nightly",
    nights: breakdown.nights_count,
    subtotal: breakdown.subtotal,
    cleaningFee: breakdown.cleaning_fee,
    total: breakdown.total,
    avgNightly: breakdown.avg_price_per_night,
    breakdown,
  };
}

export type HeadlinePrice =
  | { kind: "amount"; amount: number; per: "noche" | "mes" }
  | { kind: "consult" };

/**
 * El precio "desde" que muestra una card o un pin del mapa, según la pestaña.
 * - Por noche: la tarifa por noche (si la unidad acepta estadías cortas).
 * - Por mes: el precio mensual de lista, o "consultar" si no está cargado.
 */
export function headlinePrice(
  unit: StayUnit & { base_price: number | null | undefined; monthly_price: number | null | undefined },
  view: "noche" | "mes",
): HeadlinePrice {
  const monthly =
    unit.monthly_price != null && Number(unit.monthly_price) > 0 ? Number(unit.monthly_price) : null;
  const nightly = unit.base_price != null && Number(unit.base_price) > 0 ? Number(unit.base_price) : null;

  if (view === "mes" || !offersShortStays(unit)) {
    return monthly != null ? { kind: "amount", amount: monthly, per: "mes" } : { kind: "consult" };
  }
  return nightly != null ? { kind: "amount", amount: nightly, per: "noche" } : { kind: "consult" };
}
