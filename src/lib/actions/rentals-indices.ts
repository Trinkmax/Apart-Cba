"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/actions/auth";
import {
  INDEX_CODES,
  INDEX_META,
  IndexSeries,
  MONTHLY_COEFFICIENT_RANGE,
  indexFrequency,
  isCoefficientIndex,
  isIndexCode,
  seriesFromPoints,
  type IndexCode,
  type IndexPoint,
} from "@/lib/rentals/indices";
import { addDays, addMonthsToMonth, isYmd, monthOf } from "@/lib/rentals/ymd";
import { createAdminClient } from "@/lib/supabase/server";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { resyncContract } from "@/lib/rentals/server/contracts";
import { loadIndexPoints } from "@/lib/rentals/server/series";
import { summarizeIndex, summaryRange, type IndexSummary } from "@/components/rentals/indices/index-model";
import {
  buildCalculatorPlan,
  calculatorKeyRange,
  calculatorSummaryText,
  type CalculatorInput,
  type CalculatorResult,
} from "@/components/rentals/indices/calculator-model";

/**
 * Índices de actualización (tabla GLOBAL `economic_indices`, la llena el
 * cron diario): resumen para las tarjetas, serie para gráficos, calculadora
 * y la carga manual de Casa Propia (sólo superadmin: es un dato compartido
 * por todas las organizaciones).
 */

async function latestFetchedAt(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const { data } = await admin
    .from("economic_indices")
    .select("fetched_at")
    .neq("source", "manual")
    .order("fetched_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { fetched_at: string } | undefined;
  return row?.fetched_at ?? null;
}

export async function getIndicesOverview(): Promise<
  ActionResult<{ indices: IndexSummary[]; fetchedAt: string | null; codesInUse: IndexCode[]; isSuperadmin: boolean }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  try {
    const [indices, fetchedAt, used] = await Promise.all([
      Promise.all(
        INDEX_CODES.map(async (code) => {
          const [from, to] = summaryRange(code, ctx.today);
          return summarizeIndex(code, await loadIndexPoints(ctx.admin, code, from, to), ctx.today);
        }),
      ),
      latestFetchedAt(ctx.admin),
      ctx.admin
        .from("rental_contracts")
        .select("index_code")
        .eq("organization_id", ctx.organization.id)
        .in("status", ["vigente", "borrador"])
        .eq("adjustment_method", "indice"),
    ]);
    const codesInUse = [
      ...new Set(((used.data ?? []) as { index_code: string | null }[]).map((c) => c.index_code).filter(isIndexCode)),
    ];
    return { ok: true, indices, fetchedAt, codesInUse, isSuperadmin: !!ctx.session.profile?.is_superadmin };
  } catch (e) {
    logRentalsError("getIndicesOverview", e);
    return { ok: false, error: "No se pudieron leer los índices. Probá de nuevo en un momento." };
  }
}

/** Serie de un índice para gráficos: niveles mensuales (los diarios, el valor del día 1 de cada mes). */
export async function getIndexSeries(code: string, months = 24): Promise<ActionResult<{ code: IndexCode; points: IndexPoint[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  if (!isIndexCode(code)) return { ok: false, error: "Índice desconocido." };
  const n = Math.min(120, Math.max(2, Math.floor(Number(months) || 24)));
  const { ctx } = r;
  const firstMonth = addMonthsToMonth(monthOf(ctx.today), -n);
  try {
    if (indexFrequency(code) === "monthly") {
      const points = await loadIndexPoints(ctx.admin, code, firstMonth, monthOf(ctx.today));
      if (!isCoefficientIndex(code)) return { ok: true, code, points };
      // Casa Propia: lo guardado son coeficientes del mes; el gráfico quiere niveles encadenados.
      const chained = seriesFromPoints(code, points);
      const levels: IndexPoint[] = [];
      for (let i = 0; i <= n; i++) {
        const m = addMonthsToMonth(firstMonth, i);
        const v = chained.get(m);
        if (v !== undefined) levels.push({ date: m, value: v });
      }
      return { ok: true, code, points: levels };
    }
    const raw = await loadIndexPoints(ctx.admin, code, addDays(firstMonth, -10), ctx.today);
    const series = new IndexSeries(raw, "daily");
    const points: IndexPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const m = addMonthsToMonth(firstMonth, i);
      const v = series.get(m);
      if (v !== undefined) points.push({ date: m, value: v });
    }
    return { ok: true, code, points };
  } catch (e) {
    logRentalsError("getIndexSeries", e);
    return { ok: false, error: "No se pudo leer la serie del índice." };
  }
}

const calculatorSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: "Ingresá el monto" }).positive("El monto tiene que ser mayor a cero").max(10_000_000_000, "Revisá el monto"),
  startDate: z.string().refine(isYmd, "Elegí la fecha de inicio o del último ajuste"),
  every: z.coerce.number().int().min(1, "La frecuencia va de 1 a 12 meses").max(12, "La frecuencia va de 1 a 12 meses"),
  indexCode: z.enum(INDEX_CODES as [string, ...string[]]),
  lagMonths: z.coerce.number().int().min(0).max(3).default(2),
  rounding: z.enum(["none", "unit", "ten", "hundred", "thousand"]).default("none"),
  capPct: z.coerce.number().min(0).max(1000).nullable().optional(),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
});

export type CalculateAdjustmentInput = z.input<typeof calculatorSchema>;

export async function calculateAdjustment(
  input: CalculateAdjustmentInput,
): Promise<ActionResult<{ result: CalculatorResult; summaryText: string; lastPublished: string | null; input: CalculatorInput }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const parsed = calculatorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const { ctx } = r;
  const v = parsed.data;
  if (v.startDate < addMonthsToMonth(monthOf(ctx.today), -180) || v.startDate > addDays(ctx.today, 730)) {
    return { ok: false, error: "La fecha tiene que estar entre hace 15 años y dentro de 2 años.", field: "startDate" };
  }
  const calc: CalculatorInput = {
    amount: v.amount,
    startDate: v.startDate,
    every: v.every,
    indexCode: v.indexCode as IndexCode,
    lagMonths: v.lagMonths,
    rounding: v.rounding,
    capPct: v.capPct ?? null,
    today: ctx.today,
  };
  try {
    const range = calculatorKeyRange(calc);
    const points = range ? await loadIndexPoints(ctx.admin, calc.indexCode, range[0], range[1]) : [];
    const series = seriesFromPoints(calc.indexCode, points);
    const result = buildCalculatorPlan(calc, series);
    const { data: lastRow } = await ctx.admin
      .from("economic_indices")
      .select("period")
      .eq("index_code", calc.indexCode)
      .order("period", { ascending: false })
      .limit(1);
    const lastPublished = ((lastRow ?? [])[0] as { period: string } | undefined)?.period ?? null;
    return { ok: true, result, summaryText: calculatorSummaryText(calc, result, v.currency), lastPublished, input: calc };
  } catch (e) {
    logRentalsError("calculateAdjustment", e);
    return { ok: false, error: "No se pudo calcular. Probá de nuevo en un momento." };
  }
}

/** Contratos de la org cuyo próximo ajuste podría cambiar con un dato nuevo del índice. */
async function resyncAffected(ctx: RentalsCtx, code?: IndexCode): Promise<number> {
  let q = ctx.admin
    .from("rental_adjustments")
    .select("contract_id, contract:rental_contracts!inner(status, index_code)")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["programado", "pendiente_indice"])
    .lte("effective_date", addDays(ctx.today, 45))
    .eq("contract.status", "vigente");
  if (code) q = q.eq("contract.index_code", code);
  const { data, error } = await q;
  if (error) {
    logRentalsError("resyncAffected", error);
    return 0;
  }
  const ids = [...new Set(((data ?? []) as { contract_id: string }[]).map((a) => a.contract_id))].slice(0, 25);
  for (const id of ids) await resyncContract(ctx, id);
  return ids.length;
}

const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * "Actualizar ahora": trae los índices de INDEC/BCRA (lo mismo que hace el
 * cron cada noche) y recalcula los ajustes que estaban esperando un dato.
 * Con freno de 15 minutos: las fuentes son públicas y no hace falta pegarles
 * cada vez que alguien aprieta el botón.
 */
export async function refreshIndicesNow(): Promise<
  ActionResult<{ skipped: boolean; fetchedAt: string | null; updated: { code: string; latest: string | null; error?: string }[]; contractsResynced: number }>
> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const last = await latestFetchedAt(ctx.admin);
  if (last && Date.now() - new Date(last).getTime() < REFRESH_COOLDOWN_MS) {
    return { ok: true, skipped: true, fetchedAt: last, updated: [], contractsResynced: 0 };
  }
  try {
    const { syncEconomicIndices } = await import("@/lib/rentals/indices-sync");
    const synced = await syncEconomicIndices(ctx.admin);
    const contractsResynced = await resyncAffected(ctx);
    revalidatePath("/dashboard/alquileres");
    revalidatePath("/dashboard/alquileres/ajustes");
    return {
      ok: true,
      skipped: false,
      fetchedAt: await latestFetchedAt(ctx.admin),
      updated: synced.map((s) => ({ code: s.code, latest: s.latest, ...(s.error ? { error: s.error } : {}) })),
      contractsResynced,
    };
  } catch (e) {
    logRentalsError("refreshIndicesNow", e);
    return { ok: false, error: "No se pudieron actualizar los índices. Se vuelven a intentar solos esta noche." };
  }
}

const manualSchema = z.object({
  code: z.enum(INDEX_CODES as [string, ...string[]]),
  period: z.string().refine(isYmd, "Elegí el mes o el día del dato"),
  value: z.coerce.number({ invalid_type_error: "Ingresá el valor" }).positive("El valor tiene que ser mayor a cero").max(1_000_000_000),
});

/** Carga a mano un valor de índice (Casa Propia no se puede bajar solo). Sólo superadmin. */
export async function saveManualIndexValue(code: string, period: string, value: number): Promise<ActionResult<{ period: string }>> {
  const session = await requireSession();
  if (!session.profile?.is_superadmin) {
    return { ok: false, error: "Sólo el equipo de la plataforma puede cargar índices: son los mismos para todas las inmobiliarias." };
  }
  const parsed = manualSchema.safeParse({ code, period, value });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const c = parsed.data.code as IndexCode;
  // Casa Propia se carga como coeficiente del mes (1,0281). Un porcentaje
  // (2,81) o un nivel (105,3) encadenados darían un ajuste disparatado.
  if (isCoefficientIndex(c) && !(parsed.data.value > MONTHLY_COEFFICIENT_RANGE.min && parsed.data.value < MONTHLY_COEFFICIENT_RANGE.max)) {
    return {
      ok: false,
      error: `${INDEX_META[c].label} se carga como el coeficiente del mes, por ejemplo 1,0281 (no el porcentaje). Tiene que estar entre 0,8 y 1,5.`,
    };
  }
  const key = indexFrequency(c) === "monthly" ? monthOf(parsed.data.period) : parsed.data.period;
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("economic_indices")
    .select("source")
    .eq("index_code", c)
    .eq("period", key)
    .maybeSingle();
  if (existing && (existing as { source: string }).source !== "manual") {
    return { ok: false, error: "Ese dato ya llegó de la fuente oficial: no se pisa a mano." };
  }
  const { error } = await admin
    .from("economic_indices")
    .upsert({ index_code: c, period: key, value: parsed.data.value, source: "manual", fetched_at: new Date().toISOString() }, { onConflict: "index_code,period" });
  if (error) return dbFailure("saveManualIndexValue", error, "No se pudo guardar el valor.");
  const r = await rentalsContext("update");
  if (r.ok) await resyncAffected(r.ctx, c);
  revalidatePath("/dashboard/alquileres");
  revalidatePath("/dashboard/alquileres/ajustes");
  return { ok: true, period: key };
}

/** Borra un valor cargado a mano (por si se tipeó mal). Sólo superadmin y sólo los manuales. */
export async function deleteManualIndexValue(code: string, period: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.profile?.is_superadmin) return { ok: false, error: "Sólo el equipo de la plataforma puede borrar índices." };
  if (!isIndexCode(code) || !isYmd(period)) return { ok: false, error: "Dato inválido." };
  const admin = createAdminClient();
  const { error } = await admin.from("economic_indices").delete().eq("index_code", code).eq("period", period).eq("source", "manual");
  if (error) return dbFailure("deleteManualIndexValue", error, "No se pudo borrar el valor.");
  revalidatePath("/dashboard/alquileres/ajustes");
  return { ok: true };
}

/** Últimos valores cargados a mano de un índice (para la lista del diálogo de carga). */
export async function listManualIndexValues(code: string): Promise<ActionResult<{ values: { period: string; value: number; source: string }[] }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  if (!isIndexCode(code)) return { ok: false, error: "Índice desconocido." };
  const { data, error } = await r.ctx.admin
    .from("economic_indices")
    .select("period, value, source")
    .eq("index_code", code)
    .order("period", { ascending: false })
    .limit(12);
  if (error) return dbFailure("listManualIndexValues", error, "No se pudieron leer los valores.");
  return { ok: true, values: ((data ?? []) as { period: string; value: number | string; source: string }[]).map((v) => ({ ...v, value: Number(v.value) })) };
}
