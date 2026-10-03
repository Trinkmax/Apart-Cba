import {
  INDEX_META,
  indexFrequency,
  isCoefficientIndex,
  monthCoverage,
  seriesFromPoints,
  type IndexCode,
  type IndexPoint,
  type MonthCoverage,
} from "@/lib/rentals/indices";
import { addDays, addMonthsToMonth, diffDays, minYmd, monthOf, monthsBetween } from "@/lib/rentals/ymd";

/**
 * Resumen de un índice para las tarjetas de /ajustes y del resumen: último
 * dato, variaciones recientes y si está al día. Puro: recibe los puntos ya
 * leídos (ascendentes, como los devuelve `loadIndexPoints`).
 *
 * Los índices diarios (ICL, UVA, CER) el BCRA los publica por adelantado: el
 * valor que se muestra es el de HOY (o el último si no llega a hoy), no el
 * del último día publicado.
 */

export type Freshness = "ok" | "late" | "empty";

export interface MonthlyVariation {
  /** Mes al que corresponde la variación (YYYY-MM-01). */
  month: string;
  pct: number;
}

export interface IndexSummary {
  code: IndexCode;
  label: string;
  name: string;
  publisher: string;
  frequency: "monthly" | "daily";
  /** Fecha del valor mostrado: mes del último dato (mensual) o hoy/último día (diario). */
  refDate: string | null;
  refValue: number | null;
  /** Último día/mes publicado (en diarios puede ser posterior a hoy). */
  lastPublished: string | null;
  /** Mensual: variación del último mes. Diario: últimos 30 días. */
  monthlyPct: number | null;
  /** Mensual: acumulada de los últimos 3 meses. Diario: últimos 90 días. */
  quarterPct: number | null;
  /** Interanual (12 meses). */
  yearlyPct: number | null;
  /** Variación de cada uno de los últimos 12 meses (para el minigráfico). */
  monthly: MonthlyVariation[];
  freshness: Freshness;
  /**
   * Sólo Casa Propia (se carga a mano, mes a mes): primer y último mes
   * cargados y los huecos del medio. Con eso cada pantalla nombra el mes que
   * de verdad frena un ajuste (`waitingForIndexText`). null en los demás.
   */
  coverage: MonthCoverage | null;
}

function pct(to: number | undefined, from: number | undefined): number | null {
  if (to == null || from == null || !(from > 0)) return null;
  return Math.round((to / from - 1) * 10000) / 100;
}

/** Meses de atraso que se toleran antes de marcar un índice mensual como atrasado. */
function toleratedLag(code: IndexCode, today: string): number {
  const day = Number(today.slice(8, 10));
  // IPC: el INDEC publica el mes anterior a mediados de mes.
  if (code === "ipc") return day >= 16 ? 1 : 2;
  // RIPTE y Casa Propia salen con más demora.
  return day >= 16 ? 2 : 3;
}

export function summarizeIndex(code: IndexCode, points: IndexPoint[], today: string): IndexSummary {
  const meta = INDEX_META[code];
  const frequency = indexFrequency(code);
  // Casa Propia llega como coeficientes mensuales: la serie los encadena, así
  // las variaciones (mes, 3 meses, 12 meses) salen igual que en un índice de nivel.
  const series = seriesFromPoints(code, points);
  const base = {
    code,
    label: meta.label,
    name: meta.name,
    publisher: meta.publisher,
    frequency,
    lastPublished: series.lastDate,
    // Casa Propia se lee entera (loadIndexPoints ignora el rango): la cobertura es la real.
    coverage: isCoefficientIndex(code)
      ? monthCoverage(points.filter((p) => Number.isFinite(p.value) && p.value > 0).map((p) => p.date))
      : null,
  };
  if (!series.lastDate) {
    return { ...base, refDate: null, refValue: null, monthlyPct: null, quarterPct: null, yearlyPct: null, monthly: [], freshness: "empty" };
  }
  const last = series.lastDate;

  if (frequency === "monthly") {
    const monthly: MonthlyVariation[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = addMonthsToMonth(last, -i);
      const v = pct(series.get(m), series.get(addMonthsToMonth(m, -1)));
      if (v != null) monthly.push({ month: m, pct: v });
    }
    const behind = monthsBetween(last, monthOf(today));
    return {
      ...base,
      refDate: last,
      refValue: series.get(last) ?? null,
      monthlyPct: pct(series.get(last), series.get(addMonthsToMonth(last, -1))),
      quarterPct: pct(series.get(last), series.get(addMonthsToMonth(last, -3))),
      yearlyPct: pct(series.get(last), series.get(addMonthsToMonth(last, -12))),
      monthly,
      freshness: behind > toleratedLag(code, today) ? "late" : "ok",
    };
  }

  // Diario: valor de hoy (o del último día publicado si todavía no llega a hoy).
  const ref = minYmd(today, last);
  const at = (d: string) => series.get(d);
  const monthly: MonthlyVariation[] = [];
  const firstOfRefMonth = monthOf(ref);
  for (let i = 12; i >= 1; i--) {
    const m = addMonthsToMonth(firstOfRefMonth, -i);
    const v = pct(at(addMonthsToMonth(m, 1)), at(m));
    if (v != null) monthly.push({ month: m, pct: v });
  }
  return {
    ...base,
    refDate: ref,
    refValue: at(ref) ?? null,
    monthlyPct: pct(at(ref), at(addDays(ref, -30))),
    quarterPct: pct(at(ref), at(addDays(ref, -90))),
    yearlyPct: pct(at(ref), at(addDays(ref, -365))),
    monthly,
    freshness: diffDays(last, today) > 4 ? "late" : "ok",
  };
}

/** Rango de claves a leer para resumir un índice (≈ 14 meses hacia atrás). */
export function summaryRange(code: IndexCode, today: string): [string, string] {
  if (indexFrequency(code) === "monthly") return [addMonthsToMonth(monthOf(today), -16), monthOf(today)];
  return [addDays(addMonthsToMonth(monthOf(today), -14), -10), addDays(today, 60)];
}
