import "server-only";
import { z } from "zod";
import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney } from "@/lib/format";
import type { RentalContract, RentalSettings } from "@/lib/types/database";
import { INDEX_CODES, type IndexLookup } from "@/lib/rentals/indices";
import { formatContractNumber } from "@/lib/rentals/labels";
import { deriveRentalToken, hashRentalToken, tenantPortalPath } from "@/lib/rentals/link-token";
import { guarantorConsentError, joinNamesEs, planGuarantorConsents, renewalLegalPatch, type GuarantorConsent } from "@/lib/rentals/renewal";
import { contractEndDate } from "@/lib/rentals/schedule";
import { addDays, isYmd, maxYmd } from "@/lib/rentals/ymd";
import { loadSeriesForContract } from "./series";
import {
  applyAvailableCredit,
  billPendingTenantExpenses,
  dropStaleDifferences,
  logRentalEvent,
  syncContract,
  voidContractCharges,
  type ContractSyncSummary,
  type VoidChargesResult,
} from "./contract-sync";
import { dbFailure, logRentalsError, type ActionResult, type AdminClient, type RentalsCtx } from "./access";

/**
 * Ciclo de vida del contrato: borrador → vigente → finalizado | rescindido,
 * más la renovación (un contrato nuevo que copia las condiciones).
 */

// ─── Configuración de la org (con los defaults de la 068 si no hay fila) ────

export const DEFAULT_RENTAL_SETTINGS: Omit<RentalSettings, "organization_id" | "created_at" | "updated_at" | "updated_by"> = {
  payment_window_days: 10,
  grace_days: 0,
  late_fee_type: "diario_pct",
  late_fee_value: 0.5,
  late_fee_payee: "propietario",
  admin_fee_pct: 10,
  admin_fee_vat: false,
  tenant_commission: { basis: "pct_total_contrato", value: 5, vat: false },
  owner_commission: { basis: "ninguna", value: 0, vat: false },
  default_index: "ipc",
  default_adjustment_every: 3,
  default_lag_months: 2,
  default_rounding: "hundred",
  default_duration_months: 24,
  auto_apply_adjustments: true,
  stamp_tax_rate_pct: 0.5,
  // Ley Impositiva Córdoba 2026, art. 48: exento si el alquiler promedio mensual no supera esto.
  stamp_tax_exempt_monthly: 1230000,
  stamp_tax_tenant_share_pct: 50,
  vat_condition: "monotributo",
  broker_name: null,
  broker_license: null,
  payment_instructions: null,
  receipt_footer: null,
  charge_lead_days: 7,
};

export async function getRentalSettings(admin: AdminClient, organizationId: string): Promise<RentalSettings> {
  const { data } = await admin.from("rental_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (data) return data as RentalSettings;
  const now = new Date().toISOString();
  return { organization_id: organizationId, ...DEFAULT_RENTAL_SETTINGS, created_at: now, updated_at: now, updated_by: null };
}

// ─── Validación ─────────────────────────────────────────────────────────────

const ymd = z.string().refine(isYmd, "Fecha inválida");
const optYmd = z.union([ymd, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optText = (max: number) =>
  z.union([z.string().max(max), z.null()]).optional().transform((v) => (v && v.trim() ? v.trim() : null));
const commissionSchema = z
  .object({
    basis: z.enum(["pct_total_contrato", "meses", "monto_fijo", "ninguna"]),
    value: z.coerce.number().min(0).max(100_000_000),
    vat: z.boolean(),
  })
  .nullable()
  .optional();

const serviceSchema = z.object({
  kind: z.enum(["expensas", "luz", "gas", "agua", "municipal", "inmobiliario", "internet", "seguro", "otro"]),
  payer: z.enum(["inquilino", "propietario"]),
  proof_required: z.boolean(),
  frequency: z.enum(["mensual", "bimestral"]),
});

const partySchema = z.object({
  person_id: z.string().uuid("Elegí una persona"),
  role: z.enum(["inquilino", "garante"]),
  is_primary: z.boolean().default(false),
  guarantee_type: z
    .enum(["propietaria", "recibo_sueldo", "seguro_caucion", "fianza", "aval_bancario", "pagare", "otra"])
    .nullable()
    .optional(),
  guarantee_details: z.record(z.union([z.string(), z.number(), z.null()])).default({}),
  guarantor_consent_at: optYmd,
});

export const contractInputSchema = z
  .object({
    property_id: z.string().uuid("Elegí la propiedad"),
    usage: z.enum(["vivienda", "comercial", "mixto", "cochera", "otro"]),
    legal_regime: z.enum(["ccyc_2015", "ley_27551", "ley_27737", "dnu_70_2023"]),
    start_date: ymd,
    duration_months: z.coerce.number().int().min(1, "Mínimo 1 mes").max(120, "Máximo 120 meses"),
    signed_at: optYmd,
    currency: z.enum(["ARS", "USD"]),
    initial_rent: z.coerce.number().positive("El alquiler tiene que ser mayor a cero").max(1_000_000_000),
    adjustment_method: z.enum(["indice", "porcentaje_fijo", "escalonado", "manual", "sin_ajuste"]),
    index_code: z.enum(INDEX_CODES as [string, ...string[]]).nullable().optional(),
    adjustment_every_months: z.coerce.number().int().min(1).max(12).nullable().optional(),
    index_lag_months: z.coerce.number().int().min(0).max(3).default(2),
    fixed_pct: z.coerce.number().min(-100).max(1000).nullable().optional(),
    steps: z.array(z.coerce.number().positive()).max(60).nullable().optional(),
    rounding: z.enum(["none", "unit", "ten", "hundred", "thousand"]),
    cap_pct: z.coerce.number().min(0).max(1000).nullable().optional(),
    allow_decrease: z.boolean().default(false),
    payment_window_days: z.coerce.number().int().min(1).max(28),
    grace_days: z.coerce.number().int().min(0).max(30),
    late_fee_type: z.enum(["diario_pct", "mensual_pct", "fijo_diario", "ninguno"]),
    late_fee_value: z.coerce.number().min(0).max(100_000_000),
    late_fee_payee: z.enum(["propietario", "inmobiliaria"]),
    collector: z.enum(["inmobiliaria", "propietario"]),
    billing_starts_on: optYmd,
    admin_fee_pct: z.coerce.number().min(0).max(100),
    admin_fee_vat: z.boolean(),
    tenant_commission: commissionSchema,
    owner_commission: commissionSchema,
    deposit_amount: z.coerce.number().min(0).max(1_000_000_000),
    deposit_currency: z.enum(["ARS", "USD"]).nullable().optional(),
    deposit_holder: z.enum(["inmobiliaria", "propietario"]),
    stamp_tax_status: z.enum(["pendiente", "pagado", "exento", "no_aplica"]),
    stamp_tax_amount: z.coerce.number().min(0).nullable().optional(),
    expensas_payer: z.enum(["inquilino", "propietario", "no_aplica"]),
    expensas_mode: z.enum(["paga_inquilino", "cobra_inmobiliaria", "no_aplica"]),
    expensas_extra_payer: z.enum(["inquilino", "propietario"]),
    services: z.array(serviceSchema).max(12),
    insurance_required: z.boolean(),
    insurance_company: optText(120),
    insurance_policy: optText(80),
    insurance_expires_at: optYmd,
    early_termination_rule: z.enum(["dnu_10pct", "ley_27551", "pactada", "sin_penalidad"]),
    early_termination_notes: optText(1000),
    reli_code: optText(60),
    special_clauses: optText(8000),
    notes: optText(4000),
    parties: z.array(partySchema).min(1, "Falta el inquilino").max(12),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.adjustment_method === "indice") {
      if (!v.index_code) issue("index_code", "Elegí el índice.");
      if (!v.adjustment_every_months) issue("adjustment_every_months", "Elegí cada cuántos meses se ajusta.");
    }
    if (v.adjustment_method === "porcentaje_fijo") {
      if (v.fixed_pct == null) issue("fixed_pct", "Poné el porcentaje de cada ajuste.");
      if (!v.adjustment_every_months) issue("adjustment_every_months", "Elegí cada cuántos meses se ajusta.");
    }
    if ((v.adjustment_method === "escalonado" || v.adjustment_method === "manual") && !v.adjustment_every_months) {
      issue("adjustment_every_months", "Elegí cada cuántos meses cambia el precio.");
    }
    const tenants = v.parties.filter((p) => p.role === "inquilino");
    if (!tenants.length) issue("parties", "Falta el inquilino.");
    if (tenants.filter((p) => p.is_primary).length > 1) issue("parties", "Marcá un solo inquilino principal.");
    const ids = v.parties.map((p) => `${p.person_id}:${p.role}`);
    if (new Set(ids).size !== ids.length) issue("parties", "Hay una persona repetida con el mismo rol.");
    if (v.billing_starts_on && v.billing_starts_on < v.start_date) issue("billing_starts_on", "No puede ser anterior al inicio del contrato.");
  });

export type ContractInput = z.input<typeof contractInputSchema>;
type ContractParsed = z.output<typeof contractInputSchema>;

export function parseContractInput(input: unknown): { ok: true; data: ContractParsed } | { ok: false; error: string; field?: string } {
  const r = contractInputSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first?.message ?? "Revisá los datos del contrato.", field: first?.path?.[0] ? String(first.path[0]) : undefined };
}

// ─── Persistencia ───────────────────────────────────────────────────────────

/** Columnas del contrato a partir del input validado (sin partes ni campos de sistema). */
function contractColumns(v: ContractParsed) {
  const usesEvery = v.adjustment_method !== "sin_ajuste";
  return {
    property_id: v.property_id,
    usage: v.usage,
    legal_regime: v.legal_regime,
    start_date: v.start_date,
    duration_months: v.duration_months,
    end_date: contractEndDate(v.start_date, v.duration_months),
    signed_at: v.signed_at,
    currency: v.currency,
    initial_rent: round2(v.initial_rent),
    adjustment_method: v.adjustment_method,
    index_code: v.adjustment_method === "indice" ? (v.index_code ?? null) : null,
    adjustment_every_months: usesEvery ? (v.adjustment_every_months ?? null) : null,
    index_lag_months: v.index_lag_months,
    fixed_pct: v.adjustment_method === "porcentaje_fijo" ? (v.fixed_pct ?? null) : null,
    steps: v.adjustment_method === "escalonado" ? (v.steps ?? []) : null,
    rounding: v.rounding,
    cap_pct: v.cap_pct ?? null,
    allow_decrease: v.allow_decrease,
    payment_window_days: v.payment_window_days,
    grace_days: v.grace_days,
    late_fee_type: v.late_fee_type,
    late_fee_value: v.late_fee_value,
    late_fee_payee: v.late_fee_payee,
    collector: v.collector,
    billing_starts_on: v.billing_starts_on,
    admin_fee_pct: v.admin_fee_pct,
    admin_fee_vat: v.admin_fee_vat,
    tenant_commission: v.tenant_commission ?? null,
    owner_commission: v.owner_commission ?? null,
    deposit_amount: round2(v.deposit_amount),
    deposit_currency: v.deposit_currency ?? v.currency,
    deposit_holder: v.deposit_holder,
    deposit_status: v.deposit_amount > 0 ? undefined : "no_aplica",
    stamp_tax_status: v.stamp_tax_status,
    stamp_tax_amount: v.stamp_tax_amount ?? null,
    expensas_payer: v.expensas_payer,
    expensas_mode: v.expensas_payer === "no_aplica" ? "no_aplica" : v.expensas_mode,
    expensas_extra_payer: v.expensas_extra_payer,
    services: v.services,
    insurance_required: v.insurance_required,
    insurance_company: v.insurance_company,
    insurance_policy: v.insurance_policy,
    insurance_expires_at: v.insurance_expires_at,
    early_termination_rule: v.early_termination_rule,
    early_termination_notes: v.early_termination_notes,
    reli_code: v.reli_code,
    special_clauses: v.special_clauses,
    notes: v.notes,
  };
}

/** La propiedad y todas las personas tienen que ser de la org (la FK compuesta también lo garantiza). */
async function verifyRefs(ctx: RentalsCtx, v: ContractParsed): Promise<string | null> {
  const { data: prop } = await ctx.admin
    .from("rental_properties")
    .select("id, active")
    .eq("id", v.property_id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!prop) return "No encontramos la propiedad.";
  const personIds = [...new Set(v.parties.map((p) => p.person_id))];
  const { data: people } = await ctx.admin
    .from("rental_people")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .in("id", personIds);
  if ((people ?? []).length !== personIds.length) return "Alguna de las personas no existe en esta organización.";
  return null;
}

async function replaceParties(ctx: RentalsCtx, contractId: string, v: ContractParsed): Promise<string | null> {
  const tenants = v.parties.filter((p) => p.role === "inquilino");
  const hasPrimary = tenants.some((p) => p.is_primary);
  const rows = v.parties.map((p, i) => ({
    organization_id: ctx.organization.id,
    contract_id: contractId,
    person_id: p.person_id,
    role: p.role,
    // Si nadie marcó principal, el primer inquilino lo es (es el titular de los recibos).
    is_primary: p.role === "inquilino" && (hasPrimary ? p.is_primary : p === tenants[0]),
    guarantee_type: p.role === "garante" ? (p.guarantee_type ?? null) : null,
    guarantee_details: p.guarantee_details ?? {},
    guarantor_consent_at: p.guarantor_consent_at ?? null,
    sort_order: i,
  }));
  const { error: delErr } = await ctx.admin.from("rental_contract_parties").delete().eq("contract_id", contractId);
  if (delErr) return delErr.message;
  const { error } = await ctx.admin.from("rental_contract_parties").insert(rows);
  return error?.message ?? null;
}

/**
 * `system`: datos que no vienen del formulario. `renewedFromId` se graba en el
 * mismo insert: si quedara para un update aparte y ese update fallara, la
 * renovación se activaría sin el control de conformidad de los garantes.
 */
export async function createContractDraft(
  ctx: RentalsCtx,
  input: unknown,
  system: { renewedFromId?: string; eventSummary?: (label: string) => string } = {},
): Promise<ActionResult<{ contractId: string; number: number }>> {
  const parsed = parseContractInput(input);
  if (!parsed.ok) return parsed;
  const v = parsed.data;
  const refErr = await verifyRefs(ctx, v);
  if (refErr) return { ok: false, error: refErr };

  const { data: num, error: numErr } = await ctx.admin.rpc("rental_next_number", {
    p_organization_id: ctx.organization.id,
    p_kind: "contrato",
  });
  if (numErr) return dbFailure("createContractDraft:number", numErr, "No se pudo numerar el contrato.");
  const cols = contractColumns(v);
  const { data, error } = await ctx.admin
    .from("rental_contracts")
    .insert({
      ...cols,
      deposit_status: cols.deposit_status ?? "pendiente",
      organization_id: ctx.organization.id,
      number: num as number,
      status: "borrador",
      current_rent: cols.initial_rent,
      renewed_from_id: system.renewedFromId ?? null,
      created_by: ctx.session.userId,
      updated_by: ctx.session.userId,
    })
    .select("id, number, property_id")
    .single();
  if (error) return dbFailure("createContractDraft", error, "No se pudo guardar el contrato.");
  const partiesErr = await replaceParties(ctx, data.id as string, v);
  if (partiesErr) {
    await ctx.admin.from("rental_contracts").delete().eq("id", data.id);
    return dbFailure("createContractDraft:parties", { message: partiesErr }, "No se pudieron guardar las partes del contrato.");
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: data.id as string,
    propertyId: data.property_id as string,
    type: "contrato_creado",
    summary: system.eventSummary
      ? system.eventSummary(formatContractNumber(data.number as number))
      : `Se cargó el contrato ${formatContractNumber(data.number as number)} (borrador).`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, contractId: data.id as string, number: data.number as number };
}

/** Campos que cambian la plata ya calculada: con cobros registrados no se tocan. */
const ECONOMIC_FIELDS = [
  "start_date",
  "duration_months",
  "currency",
  "initial_rent",
  "adjustment_method",
  "index_code",
  "adjustment_every_months",
  "index_lag_months",
  "fixed_pct",
  "rounding",
  "cap_pct",
  "allow_decrease",
  "payment_window_days",
] as const;

export async function updateContract(ctx: RentalsCtx, contractId: string, input: unknown): Promise<ActionResult<{ notice: string | null }>> {
  const parsed = parseContractInput(input);
  if (!parsed.ok) return parsed;
  const v = parsed.data;
  const { data: current } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const contract = current as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status === "finalizado" || contract.status === "rescindido") {
    return { ok: false, error: "El contrato ya terminó: no se puede editar." };
  }
  const refErr = await verifyRefs(ctx, v);
  if (refErr) return { ok: false, error: refErr };

  const cols = contractColumns(v);
  const economicChange =
    ECONOMIC_FIELDS.some((f) => String((cols as Record<string, unknown>)[f] ?? "") !== String((contract as unknown as Record<string, unknown>)[f] ?? "")) ||
    JSON.stringify(cols.steps ?? null) !== JSON.stringify(contract.steps ?? null) ||
    cols.property_id !== contract.property_id;

  if (contract.status === "vigente" && economicChange) {
    const { count } = await ctx.admin
      .from("rental_payments")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId)
      .is("voided_at", null);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: "Este contrato ya tiene cobros: las condiciones económicas (fechas, precio, ajuste, propiedad) no se pueden cambiar. Si hubo un error, anulá los cobros primero o corregí el monto de un ajuste puntual.",
      };
    }
  }

  const { error } = await ctx.admin
    .from("rental_contracts")
    .update({
      ...cols,
      deposit_status: cols.deposit_status ?? contract.deposit_status,
      current_rent: contract.status === "borrador" ? cols.initial_rent : contract.current_rent,
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id);
  if (error) return dbFailure("updateContract", error, "No se pudo guardar el contrato.");
  const partiesErr = await replaceParties(ctx, contractId, v);
  if (partiesErr) return dbFailure("updateContract:parties", { message: partiesErr }, "No se pudieron guardar las partes.");

  const recalculated = contract.status === "vigente" && economicChange;
  let notice: string | null = null;
  let keptLabels: string[] = [];
  if (recalculated) {
    // Sin cobros: se rehace lo que sale de las condiciones (ajustes y alquileres
    // MENSUALES impagos). Los gastos de ingreso y los cargos extra o de salida
    // no los genera el motor: si se anularan no volverían nunca (el depósito y
    // los honorarios desaparecían de la cuenta), así que quedan como están.
    const org = ctx.organization.id;
    const reason = "Se cambiaron las condiciones del contrato";
    await ctx.admin.from("rental_adjustments").delete().eq("organization_id", org).eq("contract_id", contractId);
    try {
      const { data: monthly, error: mErr } = await ctx.admin
        .from("rental_charges")
        .select("id")
        .eq("organization_id", org)
        .eq("contract_id", contractId)
        .eq("kind", "mensual")
        .is("voided_at", null)
        .eq("paid_amount", 0);
      if (mErr) throw new Error(mErr.message);
      // Libera también los gastos que iban en esos cargos ANTES de regenerar: el
      // primer mensual nuevo los vuelve a llevar.
      const voids = await voidContractCharges(ctx.admin, org, contractId, ((monthly ?? []) as { id: string }[]).map((r) => r.id), reason);
      await dropStaleDifferences(ctx.admin, org, contractId, voids.voided, reason);
    } catch (e) {
      logRentalsError("updateContract:recalculate", e);
      notice = "Se guardaron los cambios, pero no se pudieron recalcular los alquileres impagos: revisalos en la cuenta del contrato.";
    }
    if (contract.start_date !== cols.start_date) {
      // Los gastos de ingreso vencían el día de inicio: se mueven con él.
      await ctx.admin
        .from("rental_charges")
        .update({ due_date: cols.start_date })
        .eq("organization_id", org)
        .eq("contract_id", contractId)
        .eq("kind", "ingreso")
        .is("voided_at", null)
        .eq("paid_amount", 0)
        .eq("due_date", contract.start_date);
    }
    await resyncContract(ctx, contractId);
    const { data: keptRows } = await ctx.admin
      .from("rental_charges")
      .select("label")
      .eq("organization_id", org)
      .eq("contract_id", contractId)
      .neq("kind", "mensual")
      .is("voided_at", null);
    keptLabels = [...new Set(((keptRows ?? []) as { label: string }[]).map((r) => r.label))];
    if (!notice && keptLabels.length) {
      notice = `Se recalcularon los ajustes y los alquileres impagos. Sin cambios: ${listLabels(keptLabels)}. Si dependen del precio (honorarios, sellado), revisalos en la cuenta.`;
    }
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    type: "contrato_editado",
    summary: recalculated
      ? `Se editaron las condiciones económicas del contrato: se recalcularon los ajustes y los alquileres impagos.${keptLabels.length ? ` Sin cambios: ${listLabels(keptLabels)}.` : ""}`
      : economicChange
        ? "Se editaron las condiciones del borrador."
        : "Se editaron datos del contrato.",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, notice };
}

/** "Gastos de ingreso", "Gastos de ingreso y Reparación" o "A, B y C". */
function listLabels(labels: string[]): string {
  const quoted = labels.map((l) => `«${l}»`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1]}`;
}

/**
 * Corre la sincronización completa de UN contrato (después de cualquier
 * cambio). Si su salida registrada ya pasó, lo cierra (lo mismo que hace el
 * cron a la noche): así ninguna pantalla ve un contrato "vigente" que ya
 * tendría que estar terminado.
 */
export async function resyncContract(ctx: RentalsCtx, contractId: string): Promise<void> {
  try {
    const { data } = await ctx.admin
      .from("rental_contracts")
      .select("*")
      .eq("id", contractId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    const contract = data as RentalContract | null;
    if (!contract || contract.status !== "vigente") return;
    const settings = await getRentalSettings(ctx.admin, ctx.organization.id);
    const series = await loadSeriesForContract(ctx.admin, contract);
    if (contract.terminated_at && contract.terminated_at < ctx.today) {
      await finishContract(ctx.admin, contract, { today: ctx.today, actorId: ctx.session.userId, actorName: ctx.actorName, settings, series });
      return;
    }
    await syncContract(
      ctx.admin,
      contract,
      { autoApply: settings.auto_apply_adjustments, leadDays: settings.charge_lead_days },
      { series, today: ctx.today, actorId: ctx.session.userId },
    );
  } catch (e) {
    logRentalsError("resyncContract", e);
  }
}

// ─── Activar ────────────────────────────────────────────────────────────────

export interface EntryChargeItemInput {
  kind: "deposito" | "honorarios" | "sellado" | "otro";
  description: string;
  amount: number;
}

/**
 * Borrador → vigente. Genera el link del inquilino, el cronograma de ajustes y
 * los cargos que ya tocan; opcionalmente el "cargo de ingreso" (depósito,
 * honorarios, sellado…) con lo que confirmó la persona en la pantalla.
 */
export async function activateContract(
  ctx: RentalsCtx,
  contractId: string,
  opts: { entryItems?: EntryChargeItemInput[]; entryDueDate?: string | null } = {},
): Promise<ActionResult<{ portalPath: string }>> {
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "borrador") return { ok: false, error: "El contrato ya está activo o terminado." };

  const [{ data: parties }, { data: owners }] = await Promise.all([
    ctx.admin.from("rental_contract_parties").select("role, is_primary").eq("contract_id", contractId),
    ctx.admin.from("rental_property_owners").select("ownership_pct").eq("property_id", contract.property_id),
  ]);
  if (!(parties ?? []).some((p) => p.role === "inquilino")) return { ok: false, error: "Falta cargar el inquilino." };
  const pct = round2(((owners ?? []) as { ownership_pct: number }[]).reduce((s, o) => s + Number(o.ownership_pct), 0));
  if (!owners?.length) return { ok: false, error: "La propiedad no tiene propietario cargado: agregalo antes de activar." };
  if (Math.abs(pct - 100) > 0.01) {
    return { ok: false, error: `Los porcentajes de los propietarios suman ${pct.toLocaleString("es-AR")} %; tienen que sumar 100 %.` };
  }

  const version = contract.portal_token_version || 1;
  const portalHash = hashRentalToken(deriveRentalToken("inquilino", contract.id, version));
  const { error } = await ctx.admin
    .from("rental_contracts")
    .update({ status: "vigente", portal_token_hash: portalHash, updated_by: ctx.session.userId })
    .eq("id", contractId)
    .eq("status", "borrador");
  if (error) return dbFailure("activateContract", error, "No se pudo activar el contrato.");

  const entry = (opts.entryItems ?? []).filter((i) => i.amount > 0 && i.description.trim());
  if (entry.length) {
    const payeeOf = (kind: EntryChargeItemInput["kind"]) =>
      kind === "honorarios" ? "inmobiliaria" : kind === "deposito" ? (contract.deposit_holder === "propietario" ? "propietario" : "tercero") : "tercero";
    const { error: chErr } = await ctx.admin.rpc("rental_create_charge", {
      p_organization_id: ctx.organization.id,
      p_contract_id: contract.id,
      p_charge: {
        kind: "ingreso",
        label: "Gastos de ingreso",
        due_date: opts.entryDueDate && isYmd(opts.entryDueDate) ? opts.entryDueDate : contract.start_date,
        currency: contract.currency,
        created_by: ctx.session.userId,
      },
      p_items: entry.map((i, idx) => ({
        kind: i.kind,
        payee: payeeOf(i.kind),
        description: i.description.trim().slice(0, 200),
        amount: round2(i.amount),
        sort_order: idx,
      })),
    });
    if (chErr) logRentalsError("activateContract:entry", chErr);
  }

  await resyncContract(ctx, contractId);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    propertyId: contract.property_id,
    type: "contrato_activado",
    summary: `Contrato ${formatContractNumber(contract.number)} activado.`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, portalPath: tenantPortalPath(contract.id, version) };
}

// ─── Terminar ───────────────────────────────────────────────────────────────
//
// Una salida (fin con entrega de llaves o rescisión) se REGISTRA con su fecha.
// Si la fecha ya llegó, el contrato se cierra en el momento. Si es futura,
// sigue vigente hasta ese día —el inquilino debe el alquiler hasta que
// desocupa (art. 1221 CCyC)— y lo cierra el cron (o la próxima sincronización)
// cuando la fecha pasa. `terminated_at` corta la facturación posterior y
// `termination_notice_date` distingue una rescisión de un fin.

function ddmmyyyy(ymd: string): string {
  return ymd.split("-").reverse().join("/");
}

/**
 * Anula lo facturado para después de la salida (mensuales que empiezan
 * después de `endDate`). Antes devuelve el saldo a favor que se les había
 * imputado: sin eso quedaban "pagados en parte" con plata del inquilino, que
 * se le rendía al propietario como alquiler de un mes en el que ya no vive.
 * Los gastos que llevaban vuelven a pendientes; lo que tiene cobros directos
 * queda (`kept`) para que lo resuelva una persona.
 */
async function voidChargesAfter(
  admin: AdminClient,
  organizationId: string,
  contractId: string,
  endDate: string,
  reason: string,
): Promise<VoidChargesResult> {
  const { data, error } = await admin
    .from("rental_charges")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .eq("kind", "mensual")
    .is("voided_at", null)
    .gt("period_start", endDate);
  if (error) throw new Error(`No se pudieron leer los cargos: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const res = await voidContractCharges(admin, organizationId, contractId, ids, reason, { undoCredit: true });
  await dropStaleDifferences(admin, organizationId, contractId, res.voided, reason);
  return res;
}

export interface ContractCloseOut {
  status: "finalizado" | "rescindido";
  voided: number;
  /** Cargos posteriores a la salida que tienen cobros: quedaron, los revisa una persona. */
  kept: string[];
  creditRestored: number;
  expenses: { total: number; count: number };
  sync: ContractSyncSummary;
}

/**
 * Cierra un contrato cuya salida ya llegó: anula lo facturado para después
 * (devolviendo el saldo a favor imputado), factura lo que falte hasta la
 * salida, cambia el estado y, ya cerrado, pasa los gastos pendientes del
 * inquilino a un cargo de salida. Lo anterior al cambio de estado es
 * idempotente: si algo falla, el contrato sigue vigente y la próxima corrida
 * (cron o pantalla) lo retoma sin duplicar nada. Devuelve null si no había
 * nada que cerrar (u otro proceso lo cerró primero).
 */
export async function finishContract(
  admin: AdminClient,
  contract: RentalContract,
  opts: { today: string; actorId?: string | null; actorName?: string | null; settings?: RentalSettings; series?: IndexLookup | null },
): Promise<ContractCloseOut | null> {
  if (contract.status !== "vigente" || !contract.terminated_at) return null;
  const org = contract.organization_id;
  const endDate = contract.terminated_at;
  const status = contract.termination_notice_date ? "rescindido" : "finalizado";
  const voids = await voidChargesAfter(admin, org, contract.id, endDate, status === "rescindido" ? "Contrato rescindido" : "Contrato finalizado");
  const settings = opts.settings ?? (await getRentalSettings(admin, org));
  const series = opts.series !== undefined ? opts.series : await loadSeriesForContract(admin, contract);
  const sync = await syncContract(
    admin,
    contract,
    { autoApply: settings.auto_apply_adjustments, leadDays: settings.charge_lead_days },
    { series, today: opts.today, actorId: opts.actorId ?? null },
  );
  const { data: closed, error } = await admin
    .from("rental_contracts")
    .update({ status, ...(opts.actorId ? { updated_by: opts.actorId } : {}) })
    .eq("id", contract.id)
    .eq("organization_id", org)
    .eq("status", "vigente")
    .select("id");
  if (error) throw new Error(`No se pudo cerrar el contrato: ${error.message}`);
  if (!closed?.length) return null;

  // Sólo quien ganó el cambio de estado factura los gastos pendientes: dos cierres
  // simultáneos (cron y pantalla) no los cobran dos veces. Si esto falla, los
  // gastos quedan "pendientes" a la vista, para cargarlos a mano.
  let expenses = { total: 0, count: 0, failed: false };
  try {
    const billed = await billPendingTenantExpenses(admin, contract, {
      dueDate: addDays(maxYmd(endDate, opts.today), contract.payment_window_days || 10),
      actorId: opts.actorId ?? null,
    });
    expenses = { total: billed.total, count: billed.count, failed: false };
    if (billed.chargeId) await applyAvailableCredit(admin, org, contract.id);
  } catch (e) {
    logRentalsError("finishContract:expenses", e);
    expenses = { total: 0, count: 0, failed: true };
  }

  let keptLabels: string[] = [];
  if (voids.kept.length) {
    const { data: kept } = await admin.from("rental_charges").select("label").eq("organization_id", org).in("id", voids.kept);
    keptLabels = ((kept ?? []) as { label: string }[]).map((k) => k.label);
  }
  const parts = [
    `Contrato ${formatContractNumber(contract.number)} ${status}: ${status === "rescindido" ? "desocupó" : "entregó las llaves"} el ${ddmmyyyy(endDate)}.`,
    voids.voided.length ? `Se anul${voids.voided.length === 1 ? "ó 1 cargo" : `aron ${voids.voided.length} cargos`} de meses posteriores.` : null,
    voids.creditRestored > 0 ? `Volvieron ${formatMoney(voids.creditRestored, contract.currency)} de saldo a favor al inquilino.` : null,
    expenses.count ? `Gastos sin cobrar: ${formatMoney(expenses.total, contract.currency)} en el cargo «Gastos pendientes».` : null,
    expenses.failed ? "No se pudieron pasar los gastos pendientes del inquilino a un cargo de salida: cargalos a mano." : null,
    keptLabels.length ? `Revisá ${keptLabels.join(", ")}: es posterior a la salida y tiene cobros, así que quedó como estaba.` : null,
  ].filter(Boolean);
  await logRentalEvent(admin, {
    organizationId: org,
    contractId: contract.id,
    propertyId: contract.property_id,
    type: status === "rescindido" ? "contrato_rescindido" : "contrato_finalizado",
    summary: parts.join(" "),
    payload: { voided: voids.voided, kept: voids.kept, credit_restored: voids.creditRestored, expenses_billed: expenses.total },
    actorId: opts.actorId ?? null,
    actorName: opts.actorName ?? null,
  });
  return {
    status,
    voided: voids.voided.length,
    kept: voids.kept,
    creditRestored: voids.creditRestored,
    expenses: { total: expenses.total, count: expenses.count },
    sync,
  };
}

/** Salida futura: lo facturado para después se anula ya y el contrato sigue vigente hasta ese día. */
async function scheduleExit(ctx: RentalsCtx, contractId: string, endDate: string, reason: string): Promise<void> {
  try {
    await voidChargesAfter(ctx.admin, ctx.organization.id, contractId, endDate, reason);
  } catch (e) {
    logRentalsError("scheduleExit", e);
  }
  await resyncContract(ctx, contractId);
}

export async function finalizeContract(
  ctx: RentalsCtx,
  contractId: string,
  input: { endedOn: string; reason?: string | null },
): Promise<ActionResult<{ closesOn: string | null }>> {
  if (!isYmd(input.endedOn)) return { ok: false, error: "La fecha no es válida.", field: "endedOn" };
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "vigente") return { ok: false, error: "Sólo se puede finalizar un contrato vigente." };
  if (input.endedOn < contract.start_date) return { ok: false, error: "La fecha de fin no puede ser anterior al inicio.", field: "endedOn" };
  const scheduled = contract.terminated_at;
  // Con una salida ya registrada sólo se puede adelantar a la entrega real (hoy o antes).
  if (scheduled && input.endedOn > ctx.today) {
    return {
      ok: false,
      error: `Ya tiene la salida registrada para el ${ddmmyyyy(scheduled)} y ese día se cierra solo. Si entregó las llaves antes, poné la fecha real (hoy o antes).`,
      field: "endedOn",
    };
  }
  const reason = input.reason?.trim() || contract.termination_reason || "Fin del contrato";
  const base = ctx.admin
    .from("rental_contracts")
    .update({ terminated_at: input.endedOn, termination_reason: reason, updated_by: ctx.session.userId })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente");
  const { data: saved, error } = await (scheduled ? base.eq("terminated_at", scheduled) : base.is("terminated_at", null)).select("id");
  if (error) return dbFailure("finalizeContract", error, "No se pudo finalizar el contrato.");
  if (!saved?.length) return { ok: false, error: "El contrato cambió mientras tanto. Recargá y probá de nuevo." };

  if (input.endedOn > ctx.today) {
    await scheduleExit(ctx, contractId, input.endedOn, "Contrato finalizado");
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId,
      propertyId: contract.property_id,
      type: "contrato_salida_programada",
      summary: `Entrega de llaves programada para el ${ddmmyyyy(input.endedOn)} (${reason}). Hasta ese día sigue vigente y se le sigue cobrando; después se finaliza solo.`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
    return { ok: true, closesOn: input.endedOn };
  }
  try {
    await finishContract(
      ctx.admin,
      { ...contract, terminated_at: input.endedOn, termination_reason: reason },
      { today: ctx.today, actorId: ctx.session.userId, actorName: ctx.actorName },
    );
  } catch (e) {
    logRentalsError("finalizeContract:finish", e);
    return { ok: false, error: "Se guardó la fecha de entrega, pero no se pudo cerrar la cuenta del contrato. Probá de nuevo en unos minutos." };
  }
  return { ok: true, closesOn: null };
}

export async function rescindContract(
  ctx: RentalsCtx,
  contractId: string,
  input: { noticeDate: string; moveOutDate: string; reason: string; penaltyAmount: number; chargePenalty: boolean },
): Promise<ActionResult<{ closesOn: string | null }>> {
  if (!isYmd(input.noticeDate) || !isYmd(input.moveOutDate)) return { ok: false, error: "Revisá las fechas." };
  if (input.moveOutDate < input.noticeDate) return { ok: false, error: "La desocupación no puede ser anterior a la notificación." };
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "vigente") return { ok: false, error: "Sólo se puede rescindir un contrato vigente." };
  // Una sola rescisión (y una sola indemnización) por contrato.
  if (contract.terminated_at) {
    return {
      ok: false,
      error: `Ya hay una salida registrada para este contrato (desocupa el ${ddmmyyyy(contract.terminated_at)}): no se puede registrar otra rescisión.`,
    };
  }
  if (input.moveOutDate < contract.start_date) return { ok: false, error: "La desocupación no puede ser anterior al inicio del contrato." };
  const penalty = round2(Math.max(0, input.penaltyAmount || 0));
  const reason = input.reason.trim() || "Rescisión anticipada";
  const { data: saved, error } = await ctx.admin
    .from("rental_contracts")
    .update({
      terminated_at: input.moveOutDate,
      termination_notice_date: input.noticeDate,
      termination_reason: reason,
      termination_penalty: penalty,
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente")
    .is("terminated_at", null)
    .select("id");
  if (error) return dbFailure("rescindContract", error, "No se pudo rescindir el contrato.");
  if (!saved?.length) return { ok: false, error: "El contrato cambió mientras tanto. Recargá y probá de nuevo." };

  // Hasta la desocupación el contrato sigue vigente y debe el alquiler (art. 1221).
  const future = input.moveOutDate > ctx.today;
  // Primero se anula lo posterior a la salida: el saldo a favor que vuelve queda para la indemnización.
  if (future) {
    try {
      await voidChargesAfter(ctx.admin, ctx.organization.id, contractId, input.moveOutDate, "Contrato rescindido");
    } catch (e) {
      logRentalsError("rescindContract:void", e);
    }
  }
  if (input.chargePenalty && penalty > 0) {
    const { error: chErr } = await ctx.admin.rpc("rental_create_charge", {
      p_organization_id: ctx.organization.id,
      p_contract_id: contractId,
      p_charge: { kind: "salida", label: "Indemnización por rescisión anticipada", due_date: input.moveOutDate, currency: contract.currency, created_by: ctx.session.userId },
      p_items: [{ kind: "rescision", payee: "propietario", description: "Indemnización por rescisión anticipada (art. 1221 CCyC)", amount: penalty }],
    });
    if (chErr) logRentalsError("rescindContract:penalty", chErr);
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    propertyId: contract.property_id,
    type: future ? "contrato_rescision_notificada" : "contrato_rescision_registrada",
    summary: `Rescisión: notificó el ${ddmmyyyy(input.noticeDate)}, desocupa el ${ddmmyyyy(input.moveOutDate)}${penalty > 0 ? ` · indemnización ${formatMoney(penalty, contract.currency)}` : ""}.${future ? " Hasta ese día sigue vigente y se le sigue cobrando el alquiler; después se cierra solo." : ""}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  if (future) {
    await resyncContract(ctx, contractId);
    return { ok: true, closesOn: input.moveOutDate };
  }
  try {
    await finishContract(
      ctx.admin,
      { ...contract, terminated_at: input.moveOutDate, termination_notice_date: input.noticeDate, termination_reason: reason, termination_penalty: penalty },
      { today: ctx.today, actorId: ctx.session.userId, actorName: ctx.actorName },
    );
  } catch (e) {
    logRentalsError("rescindContract:finish", e);
    return { ok: false, error: "Se registró la rescisión, pero no se pudo cerrar la cuenta del contrato. Probá de nuevo en unos minutos." };
  }
  return { ok: true, closesOn: null };
}

// ─── Continuación (art. 1218) ───────────────────────────────────────────────

/**
 * Enciende o apaga el cobro de los meses posteriores al vencimiento de un
 * contrato en el que el inquilino sigue. Sin esto no se genera ningún cargo
 * después del fin (un inquilino que se fue sin que nadie cerrara el contrato
 * no acumula deuda fantasma). Al encenderlo se generan en el momento los que
 * ya tocan, al último alquiler aplicado y sin ajustes nuevos; al apagarlo,
 * los que ya se generaron quedan en la cuenta (se anulan a mano si no van).
 */
export async function setContinuationBilling(ctx: RentalsCtx, contractId: string, on: boolean): Promise<ActionResult<{ created: number }>> {
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "vigente") return { ok: false, error: "Sólo un contrato vigente puede cobrar meses de continuación." };
  if (on && contract.end_date >= ctx.today) {
    return { ok: false, error: `El contrato todavía no venció (termina el ${ddmmyyyy(contract.end_date)}): los meses de continuación se cobran recién después.` };
  }
  if (Boolean(contract.continuation_billing) === on) return { ok: true, created: 0 };
  const { error } = await ctx.admin
    .from("rental_contracts")
    .update({ continuation_billing: on, updated_by: ctx.session.userId })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente");
  if (error) return dbFailure("setContinuationBilling", error, "No se pudo cambiar el cobro de la continuación.");
  let created = 0;
  if (on) {
    try {
      const fresh: RentalContract = { ...contract, continuation_billing: true };
      const settings = await getRentalSettings(ctx.admin, ctx.organization.id);
      const series = await loadSeriesForContract(ctx.admin, fresh);
      const sync = await syncContract(
        ctx.admin,
        fresh,
        { autoApply: settings.auto_apply_adjustments, leadDays: settings.charge_lead_days },
        { series, today: ctx.today, actorId: ctx.session.userId },
      );
      created = sync.chargesCreated;
    } catch (e) {
      logRentalsError("setContinuationBilling:sync", e);
    }
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    propertyId: contract.property_id,
    type: on ? "continuacion_activada" : "continuacion_desactivada",
    summary: on
      ? `Se activó el cobro de los meses de continuación (art. 1218 CCyC): se facturan al último alquiler, sin ajustes nuevos.${created ? ` Se ${created === 1 ? "generó 1 cargo" : `generaron ${created} cargos`}.` : ""}`
      : "Se desactivó el cobro de los meses de continuación: no se generan más cargos después del fin. Los que ya estaban siguen en la cuenta.",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, created };
}

// ─── Renovar / link / borrar borrador ───────────────────────────────────────

/**
 * Crea un borrador nuevo con las condiciones económicas y las personas del
 * contrato. Lo propio del instrumento anterior no se hereda (régimen,
 * rescisión, sellado, RELI: ver renewal.ts) y los garantes se copian sin
 * conformidad (art. 1225 CCyC): la activación la exige. `changes` le cuenta
 * a la persona qué se puso como en un contrato nuevo.
 */
export async function renewContract(
  ctx: RentalsCtx,
  contractId: string,
  input: { startDate: string; durationMonths: number; initialRent: number },
): Promise<ActionResult<{ contractId: string; number: number; changes: string[]; guarantors: number }>> {
  const orgId = ctx.organization.id;
  const [{ data }, { data: existing }] = await Promise.all([
    ctx.admin
      .from("rental_contracts")
      .select("*, parties:rental_contract_parties(person_id, role, is_primary, guarantee_type, guarantee_details, sort_order)")
      .eq("id", contractId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    ctx.admin.from("rental_contracts").select("number").eq("organization_id", orgId).eq("renewed_from_id", contractId).limit(1),
  ]);
  type OldParty = { person_id: string; role: string; is_primary: boolean; guarantee_type: string | null; guarantee_details: Record<string, string | number | null>; sort_order: number };
  const old = data as (RentalContract & { parties: OldParty[] | null }) | null;
  if (!old) return { ok: false, error: "No encontramos el contrato." };
  if (old.status === "borrador") return { ok: false, error: "Un borrador no se renueva: editalo y activalo." };
  // Una sola renovación por contrato: un doble clic o una pestaña vieja armaban dos borradores.
  const already = ((existing ?? []) as { number: number }[])[0];
  if (already) return { ok: false, error: `Ya está armada la renovación ${formatContractNumber(already.number)}: seguí desde su ficha.` };
  if (input.startDate <= old.start_date) return { ok: false, error: "La renovación tiene que empezar después del contrato actual." };

  const { patch, changes } = renewalLegalPatch(old);
  const parties = [...(old.parties ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const guarantors = parties.filter((p) => p.role === "garante").length;
  const draft = {
    ...old,
    ...patch,
    start_date: input.startDate,
    duration_months: input.durationMonths,
    initial_rent: input.initialRent,
    billing_starts_on: null,
    signed_at: null,
    // El schema descarta sort_order: el orden lo da la posición en la lista.
    parties: parties.map((p) => ({ ...p, guarantor_consent_at: null })),
  };
  const oldLabel = formatContractNumber(old.number);
  const consentNote = guarantors
    ? ` ${guarantors === 1 ? "El garante tiene" : "Los garantes tienen"} que firmar la renovación (art. 1225 CCyC): sin la fecha de su conformidad no se activa.`
    : "";
  const res = await createContractDraft(ctx, draft, {
    renewedFromId: old.id,
    eventSummary: (label) => `Se armó ${label} (borrador) como renovación de ${oldLabel}.${changes.length ? ` ${changes.join(" ")}` : ""}${consentNote}`,
  });
  if (!res.ok) return res;
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    contractId: old.id,
    propertyId: old.property_id,
    type: "contrato_renovado",
    summary: `Se armó la renovación: ${formatContractNumber(res.number)} desde el ${ddmmyyyy(input.startDate)}.${consentNote}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ...res, changes, guarantors };
}

/** Link actual del portal del inquilino. */
export function portalPathOf(contract: Pick<RentalContract, "id" | "portal_token_version">): string {
  return tenantPortalPath(contract.id, contract.portal_token_version || 1);
}

/** Genera un link nuevo (el anterior deja de funcionar). */
export async function regeneratePortalLink(ctx: RentalsCtx, contractId: string): Promise<ActionResult<{ path: string }>> {
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("id, portal_token_version")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!data) return { ok: false, error: "No encontramos el contrato." };
  const version = Number(data.portal_token_version || 1) + 1;
  const hash = hashRentalToken(deriveRentalToken("inquilino", contractId, version));
  const { error } = await ctx.admin
    .from("rental_contracts")
    .update({ portal_token_version: version, portal_token_hash: hash })
    .eq("id", contractId);
  if (error) return dbFailure("regeneratePortalLink", error, "No se pudo generar el link nuevo.");
  return { ok: true, path: tenantPortalPath(contractId, version) };
}

export async function deleteDraftContract(ctx: RentalsCtx, contractId: string): Promise<ActionResult> {
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("id, status")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!data) return { ok: false, error: "No encontramos el contrato." };
  if (data.status !== "borrador") return { ok: false, error: "Sólo se pueden borrar contratos en borrador." };
  const { error } = await ctx.admin.from("rental_contracts").delete().eq("id", contractId);
  if (error) return dbFailure("deleteDraftContract", error, "No se pudo borrar el borrador.");
  return { ok: true };
}
