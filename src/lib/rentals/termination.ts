import { round2 } from "@/lib/finance/booking-economics";
import type { RentalEarlyTerminationRule, RentalUsage } from "@/lib/types/database";
import { addMonthsClamped, contractMonthsElapsed, diffDays } from "./ymd";

/**
 * Indemnización por rescisión anticipada del inquilino y Sellos de Córdoba.
 *
 * Art. 1221 CCyC (texto del DNU 70/2023, vigente): "El locatario podrá, en
 * cualquier momento, resolver la contratación abonando el equivalente al diez
 * por ciento (10%) del saldo del canon locativo futuro, calculado desde la
 * fecha de la notificación de la rescisión hasta la fecha de finalización
 * pactada en el contrato". Es supletorio: el contrato puede pactar otra cosa.
 *
 * Ley 27.551 (contratos firmados entre 07/2020 y 10/2023): desde los 6 meses;
 * 1,5 meses de alquiler si se desocupa en el primer año, 1 mes después; en
 * vivienda, con preaviso de 3 meses o más y 6 meses cumplidos, no se paga nada.
 */

export interface TerminationResult {
  amount: number;
  /** Explicación para mostrar y para el cargo ("10 % de 17,4 meses restantes…"). */
  explanation: string;
  /** Aviso legal si algo no cierra (p. ej. antes de los 6 meses con Ley 27.551). */
  warning: string | null;
  remainingMonths: number;
}

/** Meses de contrato que faltan desde `fromDate` hasta el fin (con fracción del período en curso). */
export function remainingContractMonths(startDate: string, durationMonths: number, fromDate: string): number {
  const elapsed = contractMonthsElapsed(startDate, fromDate);
  if (elapsed < 0) return durationMonths;
  if (elapsed >= durationMonths) return 0;
  const periodStart = addMonthsClamped(startDate, elapsed);
  const nextStart = addMonthsClamped(startDate, elapsed + 1);
  const len = diffDays(periodStart, nextStart);
  const used = diffDays(periodStart, fromDate);
  const fraction = len > 0 ? used / len : 0;
  return Math.max(0, Math.round((durationMonths - elapsed - fraction) * 1000) / 1000);
}

export function computeEarlyTermination(params: {
  rule: RentalEarlyTerminationRule;
  usage: RentalUsage;
  startDate: string;
  durationMonths: number;
  /** Fecha en que el inquilino notificó. */
  noticeDate: string;
  /** Fecha en que desocupa (Ley 27.551 cuenta el primer año a esta fecha). */
  moveOutDate: string;
  currentRent: number;
  /** "pactada": monto que dice el contrato. */
  agreedAmount?: number | null;
}): TerminationResult {
  const remaining = remainingContractMonths(params.startDate, params.durationMonths, params.noticeDate);
  const rent = params.currentRent;
  switch (params.rule) {
    case "dnu_10pct": {
      const amount = round2(rent * remaining * 0.1);
      return {
        amount,
        explanation: `10 % del alquiler que faltaba cobrar: ${remaining.toLocaleString("es-AR", { maximumFractionDigits: 1 })} meses × alquiler vigente.`,
        warning: null,
        remainingMonths: remaining,
      };
    }
    case "ley_27551": {
      const monthsAtMoveOut = contractMonthsElapsed(params.startDate, params.moveOutDate);
      const monthsAtNotice = contractMonthsElapsed(params.startDate, params.noticeDate);
      const noticeDays = diffDays(params.noticeDate, params.moveOutDate);
      const warning =
        monthsAtMoveOut < 6 ? "Con la Ley 27.551 el inquilino recién puede rescindir a partir de los 6 meses." : null;
      if (params.usage === "vivienda" && noticeDays >= 90 && monthsAtNotice >= 6) {
        return {
          amount: 0,
          explanation: "Vivienda con preaviso de 3 meses o más y 6 meses cumplidos: no corresponde indemnización.",
          warning,
          remainingMonths: remaining,
        };
      }
      const firstYear = monthsAtMoveOut < 12;
      const months = firstYear ? 1.5 : 1;
      return {
        amount: round2(rent * months),
        explanation: firstYear
          ? "Desocupa en el primer año: un mes y medio de alquiler."
          : "Desocupa después del primer año: un mes de alquiler.",
        warning,
        remainingMonths: remaining,
      };
    }
    case "pactada": {
      const amount = round2(Math.max(0, params.agreedAmount ?? 0));
      return { amount, explanation: "Indemnización pactada en el contrato.", warning: null, remainingMonths: remaining };
    }
    case "sin_penalidad":
      return { amount: 0, explanation: "El contrato no prevé indemnización.", warning: null, remainingMonths: remaining };
  }
}

export interface StampTaxResult {
  /** Base = suma de los alquileres del plazo total (art. 276 Código Tributario de Córdoba). */
  base: number;
  averageMonthly: number;
  exempt: boolean;
  tax: number;
  tenantPart: number;
  ownerPart: number;
}

/**
 * Impuesto de Sellos de Córdoba sobre una locación: 5‰ (Ley Impositiva 2026,
 * art. 45 inc. 3) del valor del contrato; exento si el alquiler promedio
 * mensual no supera el tope de la Ley Impositiva (2026: $1.230.000, art. 48 /
 * art. 287 inc. 35 CTP). El impuesto es divisible: mitad cada parte salvo pacto.
 */
export function computeStampTax(params: {
  totalContractValue: number;
  durationMonths: number;
  ratePct: number;
  exemptMonthlyThreshold: number | null;
  tenantSharePct: number;
}): StampTaxResult {
  const base = round2(Math.max(0, params.totalContractValue));
  const months = Math.max(1, Math.floor(params.durationMonths));
  const averageMonthly = round2(base / months);
  const exempt = params.exemptMonthlyThreshold != null && averageMonthly <= params.exemptMonthlyThreshold;
  const tax = exempt ? 0 : round2((base * Math.max(0, params.ratePct)) / 100);
  const share = Math.min(100, Math.max(0, params.tenantSharePct));
  const tenantPart = round2((tax * share) / 100);
  return { base, averageMonthly, exempt, tax, tenantPart, ownerPart: round2(tax - tenantPart) };
}
