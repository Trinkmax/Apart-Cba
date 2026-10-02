import "server-only";
import { indexFrequency, isCoefficientIndex, seriesFromPoints, type IndexCode, type IndexLookup, type IndexPoint } from "@/lib/rentals/indices";
import { addMonthsToMonth, monthOf } from "@/lib/rentals/ymd";
import type { AdminClient } from "./access";

/**
 * Lectura de los índices guardados (tabla global `economic_indices`).
 * PostgREST corta en 1000 filas: los diarios (ICL de 3 años ≈ 1100 días) se
 * leen paginados.
 *
 * Casa Propia (coeficientes mensuales) se lee SIEMPRE entera, ignorando el
 * rango: los coeficientes se encadenan y, con un mes faltante, sólo vale el
 * último tramo sin huecos (`CoefficientSeries`). Si cada pantalla leyera un
 * rango distinto, el mismo hueco frenaría un ajuste en el cron y no en la
 * ficha. Son ~12 filas por año.
 */

const PAGE = 1000;

export async function loadIndexPoints(
  admin: AdminClient,
  code: IndexCode,
  fromKey?: string | null,
  toKey?: string | null,
): Promise<IndexPoint[]> {
  const out: IndexPoint[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    let q = admin
      .from("economic_indices")
      .select("period, value")
      .eq("index_code", code)
      .order("period", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const ranged = !isCoefficientIndex(code);
    if (fromKey && ranged) q = q.gte("period", fromKey);
    if (toKey && ranged) q = q.lte("period", toKey);
    const { data, error } = await q;
    if (error) throw new Error(`No se pudo leer el índice ${code}: ${error.message}`);
    const rows = (data ?? []) as { period: string; value: number | string }[];
    for (const r of rows) out.push({ date: r.period, value: Number(r.value) });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Rango de claves que necesita un contrato: desde antes del inicio (lag) hasta su fin. */
export function seriesRangeFor(code: IndexCode, startDate: string, endDate: string, lagMonths: number): [string, string] {
  if (indexFrequency(code) === "monthly") {
    return [addMonthsToMonth(monthOf(startDate), -(lagMonths + 1)), monthOf(endDate)];
  }
  return [startDate, endDate];
}

/** Serie lista para el motor, para un contrato (o null si no se ajusta por índice). */
export async function loadSeriesForContract(
  admin: AdminClient,
  c: { adjustment_method: string; index_code: IndexCode | null; start_date: string; end_date: string; index_lag_months: number },
): Promise<IndexLookup | null> {
  if (c.adjustment_method !== "indice" || !c.index_code) return null;
  const [from, to] = seriesRangeFor(c.index_code, c.start_date, c.end_date, c.index_lag_months);
  const points = await loadIndexPoints(admin, c.index_code, from, to);
  return seriesFromPoints(c.index_code, points);
}

/**
 * Varias series a la vez (cron / listados): una lectura por índice que cubre
 * el rango de todos los contratos que lo usan.
 */
export async function loadSeriesForContracts(
  admin: AdminClient,
  contracts: { adjustment_method: string; index_code: IndexCode | null; start_date: string; end_date: string; index_lag_months: number }[],
): Promise<Map<IndexCode, IndexLookup>> {
  const ranges = new Map<IndexCode, [string, string]>();
  for (const c of contracts) {
    if (c.adjustment_method !== "indice" || !c.index_code) continue;
    const [from, to] = seriesRangeFor(c.index_code, c.start_date, c.end_date, c.index_lag_months);
    const prev = ranges.get(c.index_code);
    ranges.set(c.index_code, prev ? [from < prev[0] ? from : prev[0], to > prev[1] ? to : prev[1]] : [from, to]);
  }
  const out = new Map<IndexCode, IndexLookup>();
  await Promise.all(
    [...ranges.entries()].map(async ([code, [from, to]]) => {
      const points = await loadIndexPoints(admin, code, from, to);
      out.set(code, seriesFromPoints(code, points));
    }),
  );
  return out;
}
