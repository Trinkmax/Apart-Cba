"use server";

import { z } from "zod";
import type { RentalContract } from "@/lib/types/database";
import { can } from "@/lib/permissions";
import { buildContractPlan } from "@/lib/rentals/plan";
import { computeEarlyTermination } from "@/lib/rentals/termination";
import { isYmd } from "@/lib/rentals/ymd";
import { rentalsContext, dbFailure, logRentalsError, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { loadSeriesForContract } from "@/lib/rentals/server/series";
import {
  activateContract,
  changeContractExit,
  createContractDraft,
  deleteDraftContract,
  finalizeContract,
  regeneratePortalLink,
  renewContract,
  rescindContract,
  setContinuationBilling,
  updateContract,
} from "@/lib/rentals/server/contracts";
import {
  buildPlanPreview,
  loadContractDetail,
  loadContractFormOptions,
  loadContractList,
  loadIntimationData,
  viewOfRow,
} from "@/lib/rentals/server/contracts-queries";
import {
  getDepositSetup,
  markDepositReceived,
  previewDepositApplication,
  reopenDeposit,
  settleDeposit,
  type DepositApplicationPreview,
  type DepositSetup,
} from "@/lib/rentals/server/deposit";
import { buildIntimationLetter } from "@/components/rentals/contracts/intimation-text";
import type { ContractDetailData, ContractFormOptions, ContractListResult, PlanPreview } from "@/components/rentals/contracts/types";

/**
 * Actions de la tajada Contratos. Envuelven los servicios de
 * `src/lib/rentals/server/contracts.ts` (validación + permisos + revalidación)
 * y devuelven los errores como valor: en producción Next.js pisa el mensaje
 * de cualquier throw.
 */

const uuid = z.string().uuid();
const ymd = z.string().refine(isYmd, "Fecha inválida");

function badId(): { ok: false; error: string } {
  return { ok: false, error: "No encontramos el contrato." };
}

/** Revalida la ficha, la propiedad y las personas del contrato. */
async function revalidateContract(ctx: RentalsCtx, contractId: string): Promise<void> {
  try {
    const [{ data: c }, { data: parties }] = await Promise.all([
      ctx.admin.from("rental_contracts").select("property_id").eq("id", contractId).eq("organization_id", ctx.organization.id).maybeSingle(),
      ctx.admin.from("rental_contract_parties").select("person_id").eq("contract_id", contractId).eq("organization_id", ctx.organization.id),
    ]);
    revalidateRentals({ contractId, propertyId: (c?.property_id as string | undefined) ?? null });
    for (const p of (parties ?? []) as { person_id: string }[]) revalidateRentals({ personId: p.person_id });
  } catch (e) {
    logRentalsError("revalidateContract", e);
    revalidateRentals({ contractId });
  }
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function getContractFormOptions(): Promise<ActionResult<{ options: ContractFormOptions }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  try {
    return { ok: true, options: await loadContractFormOptions(r.ctx) };
  } catch (e) {
    logRentalsError("getContractFormOptions", e);
    return { ok: false, error: "No se pudieron cargar las propiedades y personas." };
  }
}

const listFiltersSchema = z
  .object({
    view: z.enum(["vigentes", "por_vencer", "borradores", "terminados"]).optional(),
    q: z.string().trim().max(120).optional(),
    withDebt: z.boolean().optional(),
    adjustsThisMonth: z.boolean().optional(),
  })
  .default({});

/** Contratos de la org (con conteos por vista). Los filtros son opcionales: sin ellos, todos. */
export async function listContracts(filters?: unknown): Promise<ActionResult<{ result: ContractListResult }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const f = listFiltersSchema.safeParse(filters ?? {});
  if (!f.success) return { ok: false, error: "Filtros inválidos." };
  try {
    const all = await loadContractList(r.ctx);
    const { view, q, withDebt, adjustsThisMonth } = f.data;
    const needle = q?.toLowerCase();
    const rows = all.rows.filter(
      (row) =>
        (!view || viewOfRow(row).includes(view)) &&
        (!withDebt || row.overdue > 0.004) &&
        (!adjustsThisMonth || row.adjustsThisMonth) &&
        (!needle || [row.address, row.city, row.propertyCode, row.tenantName ?? "", String(row.number)].join(" ").toLowerCase().includes(needle)),
    );
    return { ok: true, result: { ...all, rows } };
  } catch (e) {
    logRentalsError("listContracts", e);
    return { ok: false, error: "No se pudieron cargar los contratos." };
  }
}

export async function getContractDetail(id: string): Promise<ActionResult<{ detail: ContractDetailData }>> {
  if (!uuid.safeParse(id).success) return badId();
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  try {
    const detail = await loadContractDetail(r.ctx, id);
    return detail ? { ok: true, detail } : badId();
  } catch (e) {
    logRentalsError("getContractDetail", e);
    return { ok: false, error: "No se pudo cargar el contrato." };
  }
}

const commission = z
  .object({ basis: z.enum(["pct_total_contrato", "meses", "monto_fijo", "ninguna"]), value: z.number().min(0), vat: z.boolean() })
  .nullable();

const previewSchema = z.object({
  start_date: ymd,
  duration_months: z.number().int().min(1).max(120),
  currency: z.enum(["ARS", "USD"]),
  initial_rent: z.number().positive().max(1_000_000_000),
  adjustment_method: z.enum(["indice", "porcentaje_fijo", "escalonado", "manual", "sin_ajuste"]),
  index_code: z.enum(["ipc", "icl", "casa_propia", "uva", "cer", "ripte"]).nullable(),
  adjustment_every_months: z.number().int().min(1).max(12).nullable(),
  index_lag_months: z.number().int().min(0).max(3),
  fixed_pct: z.number().min(-100).max(1000).nullable(),
  steps: z.array(z.number().min(0)).max(60).nullable(),
  rounding: z.enum(["none", "unit", "ten", "hundred", "thousand"]),
  cap_pct: z.number().min(0).max(1000).nullable(),
  allow_decrease: z.boolean(),
  payment_window_days: z.number().int().min(1).max(28),
  deposit_amount: z.number().min(0).max(1_000_000_000),
  deposit_currency: z.enum(["ARS", "USD"]),
  tenant_commission: commission,
  owner_commission: commission,
  stamp_tax_status: z.enum(["pendiente", "pagado", "exento", "no_aplica"]),
  stamp_tax_amount: z.number().min(0).nullable(),
  overrides: z.array(z.object({ sequence: z.number().int().min(1).max(200), amount: z.number().positive() })).max(60),
});

/** Plan del contrato con los índices reales, para el resumen en vivo del alta. */
export async function previewContractPlan(draft: unknown): Promise<ActionResult<{ preview: PlanPreview }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const parsed = previewSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Faltan datos para calcular." };
  try {
    return { ok: true, preview: await buildPlanPreview(r.ctx, parsed.data) };
  } catch (e) {
    logRentalsError("previewContractPlan", e);
    return { ok: false, error: "No se pudo calcular la vista previa." };
  }
}

// ─── Alta / edición ─────────────────────────────────────────────────────────

const entryItemSchema = z.object({
  kind: z.enum(["deposito", "honorarios", "sellado", "otro"]),
  description: z.string().trim().min(1, "Falta el concepto de un ítem del cargo de ingreso.").max(200),
  amount: z.number().positive("Los importes del cargo de ingreso tienen que ser mayores a cero.").max(1_000_000_000),
});

const activateSchema = z.object({
  entryItems: z.array(entryItemSchema).max(20).default([]),
  entryDueDate: z.union([ymd, z.literal(""), z.null()]).optional(),
  // Renovación (art. 1225 CCyC): fecha en que firmó cada garante, o los que no firmaron y salen del contrato.
  guarantorConsents: z
    .array(z.object({ personId: uuid, consentAt: z.string().refine(isYmd, "Revisá la fecha en que firmó el garante.") }))
    .max(12)
    .default([]),
  removeGuarantors: z.array(uuid).max(12).default([]),
});

const overrideSchema = z.object({
  sequence: z.number().int().min(1).max(200),
  amount: z.number().positive("El monto real tiene que ser mayor a cero."),
  reason: z.string().trim().max(300),
});

const saveSchema = z.object({
  id: uuid.nullable().optional(),
  input: z.unknown(),
  overrides: z.array(overrideSchema).max(60).optional(),
  activate: activateSchema.nullable().optional(),
});

/**
 * Montos reales de ajustes que ya rigieron (contratos que se cargan con la
 * historia empezada). Sólo en borradores: se guardan como ajustes APLICADOS
 * con motivo y, al activar, la sincronización los respeta (no los recalcula).
 */
async function saveDraftOverrides(ctx: RentalsCtx, contractId: string, overrides: z.infer<typeof overrideSchema>[]): Promise<string | null> {
  const orgId = ctx.organization.id;
  const { data } = await ctx.admin.from("rental_contracts").select("*").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  const c = data as RentalContract | null;
  if (!c || c.status !== "borrador") return null;
  const series = await loadSeriesForContract(ctx.admin, c).catch(() => null);
  const applied = new Map(overrides.map((o) => [o.sequence, o.amount]));
  const plan = buildContractPlan(c, { series, applied });
  const now = new Date().toISOString();
  const rows = plan.chain
    .filter((s) => applied.has(s.window.sequence) && s.window.effectiveDate <= ctx.today)
    .map((s) => {
      const o = overrides.find((x) => x.sequence === s.window.sequence) as z.infer<typeof overrideSchema>;
      const calc = s.result?.status === "ok" ? s.result : null;
      return {
        organization_id: orgId,
        contract_id: contractId,
        sequence: s.window.sequence,
        period_index: s.window.periodIndex,
        effective_date: s.window.effectiveDate,
        status: "aplicado",
        method: c.adjustment_method,
        index_code: c.adjustment_method === "indice" ? c.index_code : null,
        from_key: s.window.fromMonth ?? s.window.fromDate,
        to_key: s.window.toMonth ?? s.window.toDate,
        from_value: calc?.fromValue ?? null,
        to_value: calc?.toValue ?? null,
        coefficient: calc ? Number(calc.coefficient.toFixed(10)) : null,
        variation_pct: s.base ? Math.round((o.amount / s.base - 1) * 100_000) / 1000 : null,
        base_amount: s.base,
        computed_amount: calc?.amount ?? null,
        applied_amount: Math.round(o.amount * 100) / 100,
        override_reason: o.reason || "Monto real al cargar el contrato",
        computed_at: calc ? now : null,
        applied_at: now,
        applied_by: ctx.session.userId,
      };
    });
  const del = await ctx.admin.from("rental_adjustments").delete().eq("contract_id", contractId).eq("organization_id", orgId);
  if (del.error) return del.error.message;
  if (!rows.length) return null;
  const ins = await ctx.admin.from("rental_adjustments").insert(rows);
  return ins.error?.message ?? null;
}

/** Crea o edita el contrato; opcionalmente lo activa en el mismo paso ("Activar contrato" del asistente). */
export async function saveRentalContract(
  payload: unknown,
): Promise<ActionResult<{ contractId: string; activated: boolean; activationError: string | null; portalPath: string | null; notice: string | null }>> {
  const p = saveSchema.safeParse(payload);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Revisá los datos del contrato." };
  const { id, input, overrides, activate } = p.data;
  const r = await rentalsContext(id ? "update" : "create");
  if (!r.ok) return r;
  const { ctx } = r;

  let contractId: string;
  // Lo que la persona tiene que saber después de guardar (p. ej. qué cargos no se recalcularon).
  let notice: string | null = null;
  if (id) {
    const res = await updateContract(ctx, id, input);
    if (!res.ok) return res;
    contractId = id;
    notice = res.notice;
  } else {
    const res = await createContractDraft(ctx, input);
    if (!res.ok) return res;
    contractId = res.contractId;
  }
  if (overrides) {
    const err = await saveDraftOverrides(ctx, contractId, overrides);
    if (err) logRentalsError("saveRentalContract:overrides", { message: err });
  }

  let activated = false;
  let activationError: string | null = null;
  let portalPath: string | null = null;
  if (activate && !can(ctx.role, "rentals", "update")) {
    activationError = "Se guardó el borrador, pero no tenés permiso para activar contratos.";
  } else if (activate) {
    const a = await activateContract(ctx, contractId, { entryItems: activate.entryItems, entryDueDate: activate.entryDueDate || null });
    if (a.ok) {
      activated = true;
      portalPath = a.portalPath;
      // Una renovación cierra (o corta) el contrato anterior: su ficha también cambió.
      if (a.previousId) await revalidateContract(ctx, a.previousId);
    } else activationError = a.error;
  }
  await revalidateContract(ctx, contractId);
  return { ok: true, contractId, activated, activationError, portalPath, notice };
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────

export async function activateRentalContract(id: string, opts: unknown): Promise<ActionResult<{ portalPath: string }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = activateSchema.safeParse(opts ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá el cargo de ingreso." };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await activateContract(r.ctx, id, {
    entryItems: parsed.data.entryItems,
    entryDueDate: parsed.data.entryDueDate || null,
    guarantorConsents: parsed.data.guarantorConsents,
    removeGuarantors: parsed.data.removeGuarantors,
  });
  if (res.ok) {
    await revalidateContract(r.ctx, id);
    // Una renovación cierra (o corta) el contrato anterior: su ficha también cambió.
    if (res.previousId) await revalidateContract(r.ctx, res.previousId);
    // Los que salieron ya no son partes: revalidateContract no los encuentra.
    for (const personId of parsed.data.removeGuarantors) revalidateRentals({ personId });
  }
  return res;
}

// Vencido sin cobrar la continuación: la salida puede activarla en el mismo paso (art. 1218).
const finalizeSchema = z.object({
  endedOn: ymd,
  reason: z.string().trim().max(500).optional().nullable(),
  continuationBilling: z.boolean().optional(),
});

/** Finaliza (entrega de llaves). Con fecha futura queda programado: `closesOn` es el día en que se cierra solo. */
export async function finalizeRentalContract(id: string, input: unknown): Promise<ActionResult<{ closesOn: string | null }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá la fecha.", field: "endedOn" };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await finalizeContract(r.ctx, id, {
    endedOn: parsed.data.endedOn,
    reason: parsed.data.reason ?? null,
    continuationBilling: parsed.data.continuationBilling ?? false,
  });
  if (res.ok) await revalidateContract(r.ctx, id);
  return res;
}

const changeExitSchema = z.object({
  expected: ymd,
  // null = se anula la salida (el inquilino se queda).
  newDate: ymd.nullable(),
  continuationBilling: z.boolean().optional(),
});

/** Corre o anula una salida registrada. `notice`: lo que tiene que resolver una persona (p. ej. una indemnización ya cobrada). */
export async function changeRentalContractExit(id: string, input: unknown): Promise<ActionResult<{ closesOn: string | null; notice: string | null }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = changeExitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá la fecha.", field: "newDate" };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await changeContractExit(r.ctx, id, {
    expected: parsed.data.expected,
    newDate: parsed.data.newDate,
    continuationBilling: parsed.data.continuationBilling ?? false,
  });
  if (res.ok) await revalidateContract(r.ctx, id);
  return res;
}

const rescindSchema = z.object({
  noticeDate: ymd,
  moveOutDate: ymd,
  reason: z.string().trim().max(500).default(""),
  penaltyAmount: z.number().min(0).max(1_000_000_000).default(0),
  chargePenalty: z.boolean().default(false),
  continuationBilling: z.boolean().default(false),
});

/** Rescisión: hasta la desocupación sigue vigente (se le sigue cobrando); `closesOn` = el día que se cierra solo. */
export async function rescindRentalContract(id: string, input: unknown): Promise<ActionResult<{ closesOn: string | null }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = rescindSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos de la rescisión." };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await rescindContract(r.ctx, id, parsed.data);
  if (res.ok) await revalidateContract(r.ctx, id);
  return res;
}

/** Enciende o apaga el cobro de los meses de continuación de un contrato vencido (art. 1218). */
export async function setRentalContinuationBilling(id: string, on: unknown): Promise<ActionResult<{ created: number }>> {
  if (!uuid.safeParse(id).success) return badId();
  if (typeof on !== "boolean") return { ok: false, error: "Dato inválido." };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await setContinuationBilling(r.ctx, id, on);
  if (res.ok) await revalidateContract(r.ctx, id);
  return res;
}

const renewSchema = z.object({
  startDate: ymd,
  durationMonths: z.number().int().min(1, "Mínimo 1 mes").max(120, "Máximo 120 meses"),
  initialRent: z.number().positive("El alquiler tiene que ser mayor a cero").max(1_000_000_000),
});

/** `changes`: qué se puso como en un contrato nuevo (régimen, sellado…); `guarantors`: cuántos tienen que firmar la renovación. */
export async function renewRentalContract(
  id: string,
  input: unknown,
): Promise<ActionResult<{ contractId: string; number: number; changes: string[]; guarantors: number }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = renewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos de la renovación." };
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const res = await renewContract(r.ctx, id, parsed.data);
  if (res.ok) {
    await revalidateContract(r.ctx, id);
    await revalidateContract(r.ctx, res.contractId);
  }
  return res;
}

export async function regenerateContractPortalLink(id: string): Promise<ActionResult<{ path: string }>> {
  if (!uuid.safeParse(id).success) return badId();
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await regeneratePortalLink(r.ctx, id);
  if (res.ok) revalidateRentals({ contractId: id });
  return res;
}

export async function deleteDraftRentalContract(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return badId();
  const r = await rentalsContext("delete");
  if (!r.ok) return r;
  const { data } = await r.ctx.admin.from("rental_contracts").select("property_id").eq("id", id).eq("organization_id", r.ctx.organization.id).maybeSingle();
  const res = await deleteDraftContract(r.ctx, id);
  if (res.ok) revalidateRentals({ propertyId: (data?.property_id as string | undefined) ?? null });
  return res;
}

// ─── Rescisión: cálculo previo · Intimación ─────────────────────────────────

const terminationSchema = z.object({
  noticeDate: ymd,
  moveOutDate: ymd,
  rule: z.enum(["dnu_10pct", "ley_27551", "pactada", "sin_penalidad"]).optional(),
  agreedAmount: z.number().min(0).nullable().optional(),
});

export async function previewTermination(
  id: string,
  input: unknown,
): Promise<ActionResult<{ amount: number; explanation: string; warning: string | null; remainingMonths: number; currency: string; currentRent: number; rule: RentalContract["early_termination_rule"] }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = terminationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá las fechas." };
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { data } = await r.ctx.admin
    .from("rental_contracts")
    .select("start_date, duration_months, usage, early_termination_rule, current_rent, currency")
    .eq("id", id)
    .eq("organization_id", r.ctx.organization.id)
    .maybeSingle();
  const c = data as Pick<RentalContract, "start_date" | "duration_months" | "usage" | "early_termination_rule" | "current_rent" | "currency"> | null;
  if (!c) return badId();
  const rule = parsed.data.rule ?? c.early_termination_rule;
  const res = computeEarlyTermination({
    rule,
    usage: c.usage,
    startDate: c.start_date,
    durationMonths: c.duration_months,
    noticeDate: parsed.data.noticeDate,
    moveOutDate: parsed.data.moveOutDate,
    currentRent: Number(c.current_rent),
    agreedAmount: parsed.data.agreedAmount ?? null,
  });
  return { ok: true, ...res, currency: c.currency, currentRent: Number(c.current_rent), rule };
}

/** Texto de la carta documento por falta de pago (art. 1222 CCyC), listo para copiar. */
export async function buildIntimationText(
  id: string,
): Promise<ActionResult<{ text: string; total: number; currency: string; count: number; guarantors: string[]; hasLateFee: boolean }>> {
  if (!uuid.safeParse(id).success) return badId();
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  try {
    const res = await loadIntimationData(r.ctx, id);
    if (!res.ok) return res;
    const d = res.data;
    return {
      ok: true,
      text: buildIntimationLetter(d),
      total: d.total,
      currency: d.currency,
      count: d.lines.length,
      guarantors: d.guarantors,
      hasLateFee: d.lateFee != null,
    };
  } catch (e) {
    return dbFailure("buildIntimationText", e as { message?: string }, "No se pudo armar la intimación.");
  }
}

// ─── Depósito en garantía (068h) ────────────────────────────────────────────

/** Datos del diálogo del depósito: deuda al día, renovación y cuentas de Caja (en un viaje). */
export async function getRentalDepositSetup(id: string): Promise<ActionResult<{ setup: DepositSetup }>> {
  if (!uuid.safeParse(id).success) return badId();
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  return getDepositSetup(r.ctx, id);
}

const depositPreviewSchema = z.object({
  applied: z.number().min(0, "Lo aplicado no puede ser negativo").max(10_000_000_000),
  date: ymd,
  waiveLateFees: z.boolean().default(false),
});

/** Qué paga lo que se aplica del depósito (imputación de un cobro, con intereses a esa fecha). */
export async function previewRentalDepositApplication(id: string, input: unknown): Promise<ActionResult<{ preview: DepositApplicationPreview }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = depositPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  if (parsed.data.date > r.ctx.today) return { ok: false, error: "La fecha no puede ser futura.", field: "date" };
  return previewDepositApplication(r.ctx, id, parsed.data);
}

const markDepositSchema = z.object({
  received: z.boolean(),
  date: ymd,
  accountId: uuid.nullable().default(null),
});

/** Marca (o desmarca) cobrado un depósito que no pasó por la cuenta del inquilino. */
export async function markRentalDepositReceived(id: string, input: unknown): Promise<ActionResult<{ movementId: string | null }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = markDepositSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos del depósito." };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await markDepositReceived(r.ctx, id, parsed.data);
  if (res.ok) revalidateRentals({ contractId: id, caja: Boolean(res.movementId) });
  return res;
}

const settleDepositSchema = z.object({
  outcome: z.enum(["cerrar", "renovacion"]),
  applied: z.number().min(0, "Lo aplicado no puede ser negativo").max(10_000_000_000).default(0),
  returned: z.number().min(0, "Lo devuelto no puede ser negativo").max(10_000_000_000).default(0),
  date: ymd,
  accountId: uuid.nullable().default(null),
  note: z.string().trim().max(300, "La nota es muy larga (máximo 300 caracteres).").default(""),
  waiveLateFees: z.boolean().default(false),
});

/** Cierra el depósito de un contrato terminado: aplicado a deudas, devuelto (egreso de Caja) o pasado a la renovación. */
export async function settleRentalDeposit(
  id: string,
  input: unknown,
): Promise<ActionResult<{ status: string; receiptNumber: number | null; renewalId: string | null }>> {
  if (!uuid.safeParse(id).success) return badId();
  const parsed = settleDepositSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Revisá los datos del depósito.", field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined };
  }
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await settleDeposit(r.ctx, id, parsed.data);
  if (!res.ok) return res;
  // Lo aplicado cambia la deuda (ficha, propiedad, personas, cobranzas); lo devuelto, Caja.
  await revalidateContract(r.ctx, id);
  if (res.renewalId) await revalidateContract(r.ctx, res.renewalId);
  if (res.caja) revalidateRentals({ caja: true });
  return { ok: true, status: res.status, receiptNumber: res.receiptNumber, renewalId: res.renewalId };
}

/** Deshace el cierre del depósito (anula el cobro aplicado, borra el egreso, se lo saca a la renovación). */
export async function reopenRentalDeposit(id: string, reason: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return badId();
  if (typeof reason !== "string") return { ok: false, error: "Contá brevemente por qué se deshace.", field: "reason" };
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const res = await reopenDeposit(r.ctx, id, reason);
  if (!res.ok) return res;
  await revalidateContract(r.ctx, id);
  if (res.renewalId) await revalidateContract(r.ctx, res.renewalId);
  if (res.caja) revalidateRentals({ caja: true });
  return { ok: true };
}
