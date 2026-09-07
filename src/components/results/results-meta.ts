import { SETTLEMENT_LINE_META } from "@/lib/settlements/labels";

/**
 * Vocabulario visual de Resultados. Los colores son los MISMOS que usan las
 * líneas de la liquidación (SETTLEMENT_LINE_META) y el ejemplo de la pantalla
 * de Comisiones: rosa = plataforma, violeta = tu comisión, cian = limpieza,
 * esmeralda = propietario. Un propietario que pasa de Resultados a su
 * liquidación tiene que reconocer cada número por el color.
 */
export type ResultBucket = "channel" | "commission" | "cleaning" | "owner";

export const RESULT_BUCKET_META: Record<
  ResultBucket,
  { label: string; hint?: string; color: string; text: string }
> = {
  channel: {
    label: "Se llevan las plataformas",
    color: SETTLEMENT_LINE_META.channel_commission.color,
    text: "text-rose-600 dark:text-rose-400",
  },
  commission: {
    label: "Tu comisión",
    color: SETTLEMENT_LINE_META.commission.color,
    text: "text-violet-700 dark:text-violet-300",
  },
  cleaning: {
    label: "Limpieza",
    hint: "queda en la administración",
    color: SETTLEMENT_LINE_META.cleaning_charge.color,
    text: "text-cyan-700 dark:text-cyan-300",
  },
  owner: {
    label: "A propietarios",
    color: SETTLEMENT_LINE_META.booking_revenue.color,
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

export const RESULT_BUCKET_ORDER: ResultBucket[] = ["channel", "commission", "cleaning", "owner"];

/** Mes anterior / siguiente como (año, mes) — sin Date para no pisar la tz. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function resultsHref(year: number, month: number): string {
  return `/dashboard/resultados?year=${year}&month=${month}`;
}
