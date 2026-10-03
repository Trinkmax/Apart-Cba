import "server-only";
import { z } from "zod";
import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney } from "@/lib/format";
import type { RentalChargeItem, RentalContract, RentalSettings } from "@/lib/types/database";
import { isEngineItem, monthIsBillable, rentDiscountOf } from "@/lib/rentals/charges";
import { depositItemPayee } from "@/lib/rentals/deposit";
import { INDEX_CODES, type IndexLookup } from "@/lib/rentals/indices";
import { formatContractNumber } from "@/lib/rentals/labels";
import { deriveRentalToken, hashRentalToken, tenantPortalPath } from "@/lib/rentals/link-token";
import { guarantorConsentError, isValidConsent, joinNamesEs, planGuarantorConsents, renewalLegalPatch, type GuarantorConsent } from "@/lib/rentals/renewal";
import { chargingSchedule } from "@/lib/rentals/plan";
import { buildSchedule, contractEndDate } from "@/lib/rentals/schedule";
import {
  continuationGap,
  findOccupancyConflict,
  isRenewalHandover,
  occupancyEnd,
  planRenewalCut,
  rangesOverlap,
  type OccupancyInput,
} from "@/lib/rentals/exit";
import { addDays, isYmd, maxYmd } from "@/lib/rentals/ymd";
import { loadSeriesForContract } from "./series";
import {
  applyAvailableCredit,
  billPendingTenantExpenses,
  dropStaleDifferences,
  logRentalEvent,
  syncContract,
  unallocatedCreditOf,
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
  // Una renovación vigente sólo tiene garantes que la firmaron (art. 1225 CCyC): la activación ya lo exige.
  if (
    contract.status === "vigente" &&
    contract.renewed_from_id &&
    v.parties.some((p) => p.role === "garante" && !isValidConsent(p.guarantor_consent_at, ctx.today))
  ) {
    return {
      ok: false,
      error: "En una renovación vigente cada garante tiene que tener la fecha en que firmó la renovación (art. 1225 CCyC): cargala o sacalo del contrato.",
      field: "parties",
    };
  }

  const cols = contractColumns(v);
  // Depósito: sacarlo (monto 0) cuando ya se cobró dejaría plata en garantía sin
  // registro; volver a ponerlo después de un "sin depósito" lo reabre a cobrar.
  if (cols.deposit_status === "no_aplica" && contract.deposit_status === "retenido") {
    return {
      ok: false,
      error: "El depósito ya figura cobrado: no se puede sacar del contrato. Cuando termine, devolvelo o aplicalo a deudas desde la ficha.",
      field: "deposit_amount",
    };
  }
  // El estado del depósito se escribe sólo si cambia (sacarlo o volver a ponerlo)
  // y sólo si sigue como se leyó: desde la 068h un cobro del renglón de depósito
  // lo pasa a "retenido" por trigger, y reescribirlo con lo leído al principio de
  // la edición lo volvía a "a cobrar" con el renglón pagado.
  const depositNext = cols.deposit_status === "no_aplica" ? "no_aplica" : contract.deposit_status === "no_aplica" ? "pendiente" : null;
  const depositChange = depositNext && depositNext !== contract.deposit_status ? depositNext : null;
  const economicChange =
    ECONOMIC_FIELDS.some((f) => String((cols as Record<string, unknown>)[f] ?? "") !== String((contract as unknown as Record<string, unknown>)[f] ?? "")) ||
    JSON.stringify(cols.steps ?? null) !== JSON.stringify(contract.steps ?? null) ||
    cols.property_id !== contract.property_id;

  if (contract.status === "vigente" && economicChange) {
    const { count } = await ctx.admin
      .from("rental_payments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organization.id)
      .eq("contract_id", contractId)
      .is("voided_at", null);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: "Este contrato ya tiene cobros: las condiciones económicas (fechas, precio, ajuste, propiedad) no se pueden cambiar. Si hubo un error, anulá los cobros primero o corregí el monto de un ajuste puntual.",
      };
    }
  }
  if (contract.status === "vigente" && cols.currency !== contract.currency) {
    const blocker = await currencyChangeBlocker(ctx, contract, cols.currency);
    if (blocker) return { ok: false, error: blocker, field: "currency" };
  }

  let save = ctx.admin
    .from("rental_contracts")
    .update({
      ...cols,
      // undefined no viaja: sin cambio, la columna queda como está en la base.
      deposit_status: depositChange ?? undefined,
      current_rent: contract.status === "borrador" ? cols.initial_rent : contract.current_rent,
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id);
  if (depositChange) save = save.eq("deposit_status", contract.deposit_status);
  const { data: saved, error } = await save.select("id");
  if (error) return dbFailure("updateContract", error, "No se pudo guardar el contrato.");
  if (!saved?.length) {
    return {
      ok: false,
      error: "El depósito cambió mientras editabas el contrato (por ejemplo, se registró su cobro). Recargá la página y volvé a guardar.",
      field: "deposit_amount",
    };
  }
  const partiesErr = await replaceParties(ctx, contractId, v);
  if (partiesErr) return dbFailure("updateContract:parties", { message: partiesErr }, "No se pudieron guardar las partes.");

  const recalculated = contract.status === "vigente" && economicChange;
  let notice: string | null = null;
  let keptLabels: string[] = [];
  let carryParts: string[] = [];
  if (recalculated) {
    // Sin cobros: se rehace lo que sale de las condiciones (ajustes y alquileres
    // MENSUALES impagos). Los gastos de ingreso y los cargos extra o de salida
    // no los genera el motor: si se anularan no volverían nunca (el depósito y
    // los honorarios desaparecían de la cuenta), así que quedan como están.
    const org = ctx.organization.id;
    const reason = "Se cambiaron las condiciones del contrato";
    await ctx.admin.from("rental_adjustments").delete().eq("organization_id", org).eq("contract_id", contractId);
    let redone: MonthlyBeingRedone[] = [];
    try {
      const { data: monthly, error: mErr } = await ctx.admin
        .from("rental_charges")
        .select("id, label, period_start, items:rental_charge_items(id, kind, ref_type, description, amount, original_amount)")
        .eq("organization_id", org)
        .eq("contract_id", contractId)
        .eq("kind", "mensual")
        .is("voided_at", null)
        .eq("paid_amount", 0);
      if (mErr) throw new Error(mErr.message);
      const rows = (monthly ?? []) as MonthlyBeingRedone[];
      // Los gastos trasladados vuelven a "pendiente" ANTES de regenerar (el primer
      // mensual nuevo los vuelve a llevar). Las expensas y lo agregado a mano pasan
      // al cargo nuevo de su mes cuando se genera (ensureContractCharges).
      const voids = await voidContractCharges(ctx.admin, org, contractId, rows.map((r) => r.id), reason);
      redone = rows.filter((r) => voids.voided.includes(r.id));
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
    const [{ data: keptRows }, carry] = await Promise.all([
      ctx.admin.from("rental_charges").select("label").eq("organization_id", org).eq("contract_id", contractId).neq("kind", "mensual").is("voided_at", null),
      carryOutcome(ctx, contractId, redone),
    ]);
    keptLabels = [...new Set(((keptRows ?? []) as { label: string }[]).map((r) => r.label))];
    carryParts = carryNotice(carry, cols.currency);
    const parts = [
      ...carryParts,
      keptLabels.length ? `Sin cambios: ${listLabels(keptLabels)}. Si dependen del precio (honorarios, sellado), revisalos en la cuenta.` : null,
    ].filter(Boolean);
    if (!notice && parts.length) notice = `Se recalcularon los ajustes y los alquileres impagos. ${parts.join(" ")}`;
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    type: "contrato_editado",
    summary: recalculated
      ? `Se editaron las condiciones económicas del contrato: se recalcularon los ajustes y los alquileres impagos.${carryParts.length ? ` ${carryParts.join(" ")}` : ""}${keptLabels.length ? ` Sin cambios: ${listLabels(keptLabels)}.` : ""}`
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
 * Cambiar la moneda de un contrato vigente (sin cobros): lo que está cargado en
 * la moneda vieja y el motor no rehace (gastos de ingreso, cargos extra,
 * expensas y conceptos agregados a un mensual) se quedaría en esa moneda y los
 * cobros nuevos se le imputarían 1 a 1, o se perdería al rehacer el mensual.
 * Devuelve el mensaje para la persona, o null si no hay nada así.
 */
async function currencyChangeBlocker(ctx: RentalsCtx, contract: RentalContract, newCurrency: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("rental_charges")
    .select("kind, label, subtotal, paid_amount, items:rental_charge_items(kind, ref_type, description, amount)")
    .eq("organization_id", ctx.organization.id)
    .eq("contract_id", contract.id)
    .eq("currency", contract.currency)
    .is("voided_at", null);
  if (error) {
    logRentalsError("updateContract:currency", error);
    return "No se pudo revisar la cuenta del contrato para cambiar la moneda. Probá de nuevo.";
  }
  type Row = { kind: string; label: string; subtotal: number; paid_amount: number; items: Pick<RentalChargeItem, "kind" | "ref_type" | "description" | "amount">[] };
  const found: string[] = [];
  for (const c of (data ?? []) as Row[]) {
    if (c.kind !== "mensual") {
      if (round2(Number(c.subtotal) - Number(c.paid_amount)) > 0) found.push(`«${c.label}»`);
      continue;
    }
    for (const i of c.items) if (!isEngineItem(i) && Number(i.amount) > 0) found.push(`«${i.description}» (en ${c.label})`);
  }
  if (!found.length) return null;
  const shown = found.length > 4 ? [...found.slice(0, 3), `${found.length - 3} más`] : found;
  return `Para pasar el contrato a ${newCurrency}, primero sacá lo que está cargado en ${contract.currency} y no se recalcula solo: ${joinNamesEs(shown)}. Anulá esos cargos (las expensas se ponen en 0 desde «Cargar expensas» y un concepto agregado se bonifica entero) y, con la moneda cambiada, volvé a cargarlos en ${newCurrency}.`;
}

type MonthlyBeingRedone = {
  id: string;
  label: string;
  period_start: string | null;
  items: Pick<RentalChargeItem, "id" | "kind" | "ref_type" | "description" | "amount" | "original_amount">[];
};

/** Qué pasó con lo cargado a mano en los mensuales que se rehicieron (para avisar). */
interface CarryOutcome {
  /** Ya está en el cargo nuevo de su mes. */
  carried: string[];
  /** Su mes todavía no tiene cargo: pasa solo cuando se genere. */
  waiting: string[];
  /** Su mes ya no se factura (cambió el inicio o la duración): quedó anulado. */
  dropped: string[];
  /** El cargo nuevo se generó sin ellos (la base los rechazó): hay que cargarlos de nuevo. */
  failed: string[];
  /** Bonificaciones del alquiler, que no pasan (el alquiler sale del contrato). */
  discounts: { label: string; amount: number }[];
}

async function carryOutcome(ctx: RentalsCtx, contractId: string, redone: MonthlyBeingRedone[]): Promise<CarryOutcome> {
  const out: CarryOutcome = { carried: [], waiting: [], dropped: [], failed: [], discounts: [] };
  const discounted = redone.map((r) => ({ label: r.label, month: r.period_start?.slice(0, 7) ?? "", amount: rentDiscountOf(r.items) })).filter((d) => d.amount > 0);
  const pending = redone.flatMap((r) => r.items.filter((i) => !isEngineItem(i) && Number(i.amount) > 0).map((i) => ({ ...i, month: r.period_start?.slice(0, 7) ?? "" })));
  if (!pending.length && !discounted.length) return out;
  const [{ data: live }, { data: fresh }] = await Promise.all([
    ctx.admin
      .from("rental_charges")
      .select("period_start, items:rental_charge_items(meta)")
      .eq("organization_id", ctx.organization.id)
      .eq("contract_id", contractId)
      .eq("kind", "mensual")
      .is("voided_at", null),
    ctx.admin.from("rental_contracts").select("*").eq("id", contractId).eq("organization_id", ctx.organization.id).maybeSingle(),
  ]);
  const liveRows = (live ?? []) as { period_start: string | null; items: { meta: Record<string, unknown> | null }[] }[];
  const carriedFrom = new Set(liveRows.flatMap((r) => r.items.map((i) => String(i.meta?.carried_from ?? ""))).filter(Boolean));
  const liveMonths = new Set(liveRows.map((r) => r.period_start?.slice(0, 7) ?? ""));
  const c = fresh as RentalContract | null;
  const schedule = c
    ? chargingSchedule(
        buildSchedule({ startDate: c.start_date, durationMonths: c.duration_months, adjustmentEveryMonths: c.adjustment_every_months, paymentWindowDays: c.payment_window_days }),
        c,
        addDays([...pending, ...discounted].map((p) => `${p.month}-01`).reduce((a, b) => (a > b ? a : b)), 31),
      )
    : [];
  const billable = (month: string) =>
    Boolean(c && monthIsBillable(schedule, `${month}-01`, { billingStartsOn: c.billing_starts_on ?? c.start_date, terminatedAt: c.terminated_at }));
  for (const p of pending) {
    if (carriedFrom.has(p.id)) out.carried.push(p.description);
    else if (liveMonths.has(p.month)) out.failed.push(p.description);
    else if (billable(p.month)) out.waiting.push(p.description);
    else out.dropped.push(p.description);
  }
  // Sólo si el mes se sigue cobrando: si quedó afuera del contrato no hay alquiler que bonificar.
  out.discounts = discounted.filter((d) => liveMonths.has(d.month) || billable(d.month)).map((d) => ({ label: d.label, amount: d.amount }));
  return out;
}

/** Lo que la persona tiene que saber de lo cargado a mano después de rehacer los mensuales. */
function carryNotice(o: CarryOutcome, currency: string): string[] {
  const one = (list: string[], singular: string, plural: string) => (list.length === 1 ? singular : plural);
  return [
    o.carried.length ? `${one(o.carried, "Pasó", "Pasaron")} a los cargos nuevos: ${listLabels(o.carried)}.` : null,
    o.waiting.length
      ? `${listLabels(o.waiting)} ${one(o.waiting, "pasa solo", "pasan solos")} al cargo de su mes cuando se genere: no ${one(o.waiting, "lo", "los")} cargues de nuevo.`
      : null,
    o.dropped.length
      ? `${listLabels(o.dropped)} ${one(o.dropped, "quedó anulado", "quedaron anulados")} con su cargo porque ese mes ya no se cobra en el contrato: si corresponde, ${one(o.dropped, "cargalo", "cargalos")} aparte.`
      : null,
    o.failed.length ? `No se ${one(o.failed, "pudo pasar", "pudieron pasar")} ${listLabels(o.failed)} al cargo nuevo: ${one(o.failed, "cargalo", "cargalos")} de nuevo.` : null,
    ...o.discounts.map(
      (d) => `La bonificación de ${formatMoney(d.amount, currency)} del alquiler de ${d.label} no pasó al cargo nuevo: si sigue correspondiendo, volvé a bonificarlo.`,
    ),
  ].filter((s): s is string => Boolean(s));
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

// ─── Ocupación de la propiedad ──────────────────────────────────────────────
//
// Dos contratos vigentes no ocupan la misma propiedad el mismo día
// (rental_contracts_no_overlap). La ocupación se mide hasta la salida REAL
// (ver occupancyEnd en exit.ts, la misma cuenta que la 068i): se chequea antes
// de escribir para decir con qué contrato choca y hasta cuándo, en vez del
// mensaje genérico de la base.

type Occupant = OccupancyInput & {
  id: string;
  number: number;
  renewed_from_id: string | null;
  termination_notice_date: string | null;
};

/** Contratos vigentes de la propiedad. Si no se pueden leer, no se frena nada acá: frena la base. */
async function vigentesOfProperty(ctx: RentalsCtx, propertyId: string): Promise<Occupant[]> {
  const { data, error } = await ctx.admin
    .from("rental_contracts")
    .select("id, number, start_date, end_date, terminated_at, termination_notice_date, continuation_billing, renewed_from_id")
    .eq("organization_id", ctx.organization.id)
    .eq("property_id", propertyId)
    .eq("status", "vigente");
  if (error) {
    logRentalsError("vigentesOfProperty", error);
    return [];
  }
  return (data ?? []) as Occupant[];
}

/** "El contrato N° 0003 ocupa la propiedad hasta el 15/12/2026 (rescisión notificada)". */
function occupantText(o: Occupant): string {
  const label = formatContractNumber(o.number);
  if (o.terminated_at) {
    return `El contrato ${label} ocupa la propiedad hasta el ${ddmmyyyy(o.terminated_at)} (${o.termination_notice_date ? "rescisión notificada" : "salida registrada"})`;
  }
  if (o.continuation_billing) return `El contrato ${label} venció el ${ddmmyyyy(o.end_date)} y sigue ocupando la propiedad (se le cobran los meses de continuación)`;
  return `El contrato ${label} rige en la propiedad hasta el ${ddmmyyyy(o.end_date)}`;
}

function isOverlapError(error: { message?: string } | null | undefined): boolean {
  return Boolean(error?.message?.includes("rental_contracts_no_overlap"));
}

/**
 * La base frenó una superposición. Si la cuenta de la app no la ve, la base
 * todavía mide [inicio, fin] (falta la 068i) o alguien activó otro contrato
 * recién: se dice cuál y hasta cuándo.
 */
async function overlapMessage(
  ctx: RentalsCtx,
  propertyId: string,
  range: { selfId: string; start: string; end: string | null },
  renewedId: string | null = null,
): Promise<string> {
  const others = await vigentesOfProperty(ctx, propertyId);
  const conflict = findOccupancyConflict(others, range);
  if (conflict) return `${occupantText(conflict)}. Cambiá las fechas o registrá antes la salida de ese contrato.`;
  const legacy = others.find((o) => o.id !== range.selfId && rangesOverlap(range.start, range.end, o.start_date, o.end_date));
  if (legacy && legacy.id === renewedId) {
    return `Todavía no se puede activar una renovación que empieza antes del fin del contrato anterior (${formatContractNumber(legacy.number)}, termina el ${ddmmyyyy(legacy.end_date)}). Hacela empezar el ${ddmmyyyy(addDays(legacy.end_date, 1))} o probá de nuevo en unos días.`;
  }
  if (legacy?.terminated_at) {
    return `Todavía no se puede: el contrato ${formatContractNumber(legacy.number)} desocupa el ${ddmmyyyy(legacy.terminated_at)}, pero hasta que se cierre figura vigente hasta su fin (${ddmmyyyy(legacy.end_date)}). Probá de nuevo el ${ddmmyyyy(addDays(legacy.terminated_at, 1))}.`;
  }
  return "Ya hay un contrato vigente para esa propiedad en esas fechas. Recargá la página: puede que alguien lo haya activado recién.";
}

/** Renovación (no borrador, misma propiedad) que arranca a más tardar el día siguiente a la salida. */
async function renewalTakingOver(
  admin: AdminClient,
  contract: RentalContract,
  exitDate: string,
): Promise<{ id: string; number: number; start_date: string } | null> {
  const { data, error } = await admin
    .from("rental_contracts")
    .select("id, number, start_date")
    .eq("organization_id", contract.organization_id)
    .eq("renewed_from_id", contract.id)
    .eq("property_id", contract.property_id)
    .neq("status", "borrador")
    .order("start_date", { ascending: true })
    .limit(1);
  // Sin saber si lo sigue una renovación no se cierra: tratarlo como mudanza le cobraría la salida.
  if (error) throw new Error(`No se pudo leer la renovación: ${error.message}`);
  const r = ((data ?? []) as { id: string; number: number; start_date: string }[])[0];
  return r && isRenewalHandover(exitDate, r.start_date) ? r : null;
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
 *
 * Una renovación sólo se activa con cada garante en regla (art. 1225 CCyC):
 * la fecha en que firmó —`guarantorConsents` la carga desde el mismo diálogo—
 * o fuera del contrato (`removeGuarantors`). Ver renewal.ts.
 *
 * Desde el inicio de la renovación los meses los cobra ella: el contrato
 * anterior termina el día antes (si hace falta se le registra esa salida,
 * se anulan sus cargos impagos posteriores y se cierra como traspaso, sin
 * cargo de salida). Si ya tiene cobrado alguno de esos meses, no se activa
 * hasta que una persona lo resuelva. `previousId`: el anterior, para revalidarlo.
 */
export async function activateContract(
  ctx: RentalsCtx,
  contractId: string,
  opts: {
    entryItems?: EntryChargeItemInput[];
    entryDueDate?: string | null;
    guarantorConsents?: GuarantorConsent[];
    removeGuarantors?: string[];
  } = {},
): Promise<ActionResult<{ portalPath: string; previousId: string | null }>> {
  const orgId = ctx.organization.id;
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "borrador") return { ok: false, error: "El contrato ya está activo o terminado." };

  const [{ data: parties }, { data: owners }, { data: previousRow }] = await Promise.all([
    ctx.admin.from("rental_contract_parties").select("person_id, role, is_primary, guarantor_consent_at").eq("contract_id", contractId).eq("organization_id", orgId),
    ctx.admin.from("rental_property_owners").select("ownership_pct").eq("property_id", contract.property_id),
    contract.renewed_from_id
      ? ctx.admin.from("rental_contracts").select("*").eq("id", contract.renewed_from_id).eq("organization_id", orgId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const partyRows = (parties ?? []) as { person_id: string; role: string; is_primary: boolean; guarantor_consent_at: string | null }[];
  if (!partyRows.some((p) => p.role === "inquilino")) return { ok: false, error: "Falta cargar el inquilino." };
  const pct = round2(((owners ?? []) as { ownership_pct: number }[]).reduce((s, o) => s + Number(o.ownership_pct), 0));
  if (!owners?.length) return { ok: false, error: "La propiedad no tiene propietario cargado: agregalo antes de activar." };
  if (Math.abs(pct - 100) > 0.01) {
    return { ok: false, error: `Los porcentajes de los propietarios suman ${pct.toLocaleString("es-AR")} %; tienen que sumar 100 %.` };
  }

  let renewalNote = "";
  const label = formatContractNumber(contract.number);
  // Contrato anterior todavía vigente: desde que empieza la renovación los meses
  // los cobra ella. Se corta el día antes; antes de tocar nada se ve que se pueda.
  const previous = contract.renewed_from_id ? ((previousRow as RentalContract | null) ?? null) : null;
  const previousLive = previous?.status === "vigente" ? previous : null;
  let cut: string | null = null;
  if (previousLive) {
    const prevLabel = formatContractNumber(previousLive.number);
    const renewalCut = planRenewalCut(previousLive, contract.start_date);
    if (renewalCut.kind === "starts_before") {
      return { ok: false, error: `La renovación empieza antes que el contrato anterior (${prevLabel}, desde el ${ddmmyyyy(previousLive.start_date)}): revisá la fecha de inicio.` };
    }
    if (renewalCut.kind === "exit_after_start") {
      return {
        ok: false,
        error: `El contrato anterior (${prevLabel}) tiene ${renewalCut.rescission ? "una rescisión notificada" : "la entrega de llaves registrada"} para el ${ddmmyyyy(renewalCut.exitDate)}, después de que empiece la renovación (${ddmmyyyy(contract.start_date)}). Si el inquilino se queda, anulá esa salida desde su ficha («Cambiar la salida») y activá la renovación.`,
      };
    }
    const paidErr = await paidOverlapWithRenewal(ctx, previousLive, contract);
    if (paidErr) return { ok: false, error: paidErr };
    if (renewalCut.kind === "cut") cut = renewalCut.cutDate;
  }
  // Con quién más choca en la propiedad (el anterior, ya con su corte).
  const occupants = (await vigentesOfProperty(ctx, contract.property_id)).map((o) => (cut && o.id === previousLive?.id ? { ...o, terminated_at: cut } : o));
  const ownRange = { selfId: contract.id, start: contract.start_date, end: occupancyEnd(contract) };
  const occupied = findOccupancyConflict(occupants, ownRange);
  if (occupied) {
    return {
      ok: false,
      error: `${occupantText(occupied)}. Este contrato empieza el ${ddmmyyyy(contract.start_date)}: hacelo empezar después, o registrá antes la salida de ese contrato desde su ficha.`,
    };
  }

  if (contract.renewed_from_id) {
    const plan = planGuarantorConsents(partyRows, { consents: opts.guarantorConsents, remove: opts.removeGuarantors, today: ctx.today });
    const guarantorIds = partyRows.filter((p) => p.role === "garante").map((p) => p.person_id);
    const names = await personNames(ctx, guarantorIds);
    const nameOf = (id: string) => names.get(id) ?? "un garante";
    const consentErr = guarantorConsentError(plan, nameOf);
    if (consentErr) return { ok: false, error: consentErr, field: "guarantors" };
    // Antes de activar: si la activación fallara, la conformidad cargada igual es un hecho y queda.
    for (const u of plan.updates) {
      const { error: upErr } = await ctx.admin
        .from("rental_contract_parties")
        .update({ guarantor_consent_at: u.consentAt })
        .eq("organization_id", orgId)
        .eq("contract_id", contractId)
        .eq("person_id", u.personId)
        .eq("role", "garante");
      if (upErr) return dbFailure("activateContract:consent", upErr, "No se pudo guardar la conformidad de los garantes.");
    }
    if (plan.removals.length) {
      const { error: rmErr } = await ctx.admin
        .from("rental_contract_parties")
        .delete()
        .eq("organization_id", orgId)
        .eq("contract_id", contractId)
        .eq("role", "garante")
        .in("person_id", plan.removals);
      if (rmErr) return dbFailure("activateContract:removeGuarantors", rmErr, "No se pudo sacar del contrato a los garantes que no firmaron.");
    }
    const signedOn = new Map(partyRows.filter((p) => p.role === "garante" && p.guarantor_consent_at).map((p) => [p.person_id, p.guarantor_consent_at as string]));
    for (const u of plan.updates) signedOn.set(u.personId, u.consentAt);
    for (const id of plan.removals) signedOn.delete(id);
    const signed = [...signedOn].map(([id, d]) => `${nameOf(id)} (${ddmmyyyy(d)})`);
    if (signed.length) renewalNote += ` Firmaron la renovación como garantes (art. 1225 CCyC): ${joinNamesEs(signed)}.`;
    if (plan.removals.length) {
      renewalNote += ` ${plan.removals.length === 1 ? "Salió" : "Salieron"} del contrato por no firmar la renovación: ${joinNamesEs(plan.removals.map(nameOf))}.`;
    }
  }

  // El corte del anterior va justo antes de activar: es lo que deja libre la propiedad
  // desde el inicio de la renovación. Si la activación falla, se deshace.
  const cutReason = `Renovado por ${label}`;
  if (previousLive && cut) {
    const { data: cutRows, error: cutErr } = await ctx.admin
      .from("rental_contracts")
      .update({ terminated_at: cut, termination_reason: cutReason, updated_by: ctx.session.userId })
      .eq("id", previousLive.id)
      .eq("organization_id", orgId)
      .eq("status", "vigente")
      .is("terminated_at", null)
      .select("id");
    if (cutErr) return dbFailure("activateContract:cut", cutErr, "No se pudo cerrar el contrato anterior en la fecha de la renovación.");
    if (!cutRows?.length) return { ok: false, error: "El contrato anterior cambió mientras tanto. Recargá y probá de nuevo." };
  }
  const undoCut = async () => {
    if (!previousLive || !cut) return;
    const { error: undoErr } = await ctx.admin
      .from("rental_contracts")
      .update({ terminated_at: null, termination_reason: previousLive.termination_reason })
      .eq("id", previousLive.id)
      .eq("organization_id", orgId)
      .eq("status", "vigente")
      .eq("terminated_at", cut);
    if (undoErr) logRentalsError("activateContract:undoCut", undoErr);
  };

  const version = contract.portal_token_version || 1;
  const portalHash = hashRentalToken(deriveRentalToken("inquilino", contract.id, version));
  const { data: flipped, error } = await ctx.admin
    .from("rental_contracts")
    .update({ status: "vigente", portal_token_hash: portalHash, updated_by: ctx.session.userId })
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .eq("status", "borrador")
    .select("id");
  if (error) {
    // Con el corte todavía puesto: así el mensaje ve la salida que se le registró al anterior.
    const overlap = isOverlapError(error) ? await overlapMessage(ctx, contract.property_id, ownRange, previousLive && cut ? previousLive.id : null) : null;
    await undoCut();
    return overlap ? { ok: false, error: overlap } : dbFailure("activateContract", error, "No se pudo activar el contrato.");
  }
  // Otra pestaña lo activó entre la lectura y acá: seguir generaba un segundo cargo de ingreso.
  if (!flipped?.length) {
    await undoCut();
    return { ok: false, error: "El contrato ya está activo o terminado." };
  }

  const entry = (opts.entryItems ?? []).filter((i) => i.amount > 0 && i.description.trim());
  if (entry.length) {
    const payeeOf = (kind: EntryChargeItemInput["kind"]) =>
      kind === "honorarios" ? "inmobiliaria" : kind === "deposito" ? depositItemPayee(contract.deposit_holder) : "tercero";
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

  // El anterior, antes de sincronizar este: si se cierra ya, sus gastos pendientes
  // pasan a la renovación y entran en su primer cargo.
  if (previousLive) {
    const prevLabel = formatContractNumber(previousLive.number);
    const handoverAtEnd = !cut && !previousLive.terminated_at && isRenewalHandover(previousLive.end_date, contract.start_date);
    const lastDay = cut ?? previousLive.terminated_at ?? previousLive.end_date;
    try {
      if (cut && cut >= ctx.today) {
        // Sigue vigente hasta el corte: se anulan ya los cargos posteriores y lo cierra el cron.
        await scheduleExit(ctx, previousLive.id, cut, cutReason);
      } else if (cut) {
        await resyncContract(ctx, previousLive.id);
      } else if (handoverAtEnd && previousLive.end_date < ctx.today) {
        await closeRenewedAtEnd(ctx.admin, previousLive, { number: contract.number }, { today: ctx.today, actorId: ctx.session.userId, actorName: ctx.actorName });
      }
    } catch (e) {
      // Queda vigente con su salida (o su fin) y el cron lo cierra a la noche.
      logRentalsError("activateContract:previous", e);
    }
    // Traspaso: la renovación arranca al día siguiente. Si no, quedan días sin cubrir que decide una persona.
    const handover = Boolean(cut) || isRenewalHandover(lastDay, contract.start_date);
    renewalNote += handover
      ? ` ${prevLabel} sigue hasta el ${ddmmyyyy(lastDay)}: desde el ${ddmmyyyy(contract.start_date)} cobra esta renovación.`
      : ` Entre el fin del ${prevLabel} (${ddmmyyyy(lastDay)}) y el inicio de esta quedan días sin cubrir.`;
    await logRentalEvent(ctx.admin, {
      organizationId: orgId,
      contractId: previousLive.id,
      propertyId: previousLive.property_id,
      type: "renovacion_activada",
      summary: handover
        ? `Se activó la renovación ${label} desde el ${ddmmyyyy(contract.start_date)}. Este contrato sigue hasta el ${ddmmyyyy(lastDay)} y ese día se cierra solo, sin cargo de salida${cut ? "; se anularon sus cargos impagos posteriores" : ""}.`
        : `Se activó la renovación ${label} desde el ${ddmmyyyy(contract.start_date)}. Entre el fin de este contrato (${ddmmyyyy(lastDay)}) y el inicio de la renovación quedan días sin cubrir: si el inquilino sigue, cobralos con la continuación o registrá la salida.`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }

  await resyncContract(ctx, contractId);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    propertyId: contract.property_id,
    type: "contrato_activado",
    summary: `Contrato ${label} activado.${renewalNote}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, portalPath: tenantPortalPath(contract.id, version), previousId: previous?.id ?? null };
}

/**
 * Alquileres del contrato anterior ya cobrados para meses que también va a
 * cobrar la renovación: anularlos devolvería plata que se cobró (y quizás se
 * rindió), así que lo decide una persona. Lo imputado con saldo a favor no
 * frena: al anular el cargo vuelve como saldo a favor. Mira desde el inicio de
 * la renovación, o desde que empieza a cobrar si se corrió ("Se empieza a
 * cobrar desde"): esa es la salida que se le ofrece a la persona.
 */
async function paidOverlapWithRenewal(
  ctx: RentalsCtx,
  previous: RentalContract,
  renewal: Pick<RentalContract, "number" | "start_date" | "billing_starts_on">,
): Promise<string | null> {
  const orgId = ctx.organization.id;
  const billingFrom = maxYmd(renewal.start_date, renewal.billing_starts_on ?? renewal.start_date);
  const { data, error } = await ctx.admin
    .from("rental_charges")
    .select("id, label")
    .eq("organization_id", orgId)
    .eq("contract_id", previous.id)
    .eq("kind", "mensual")
    .is("voided_at", null)
    .gte("period_start", renewal.start_date)
    .gte("period_end", billingFrom)
    .gt("paid_amount", 0);
  if (error) return dbFailure("paidOverlapWithRenewal", error, "No se pudo revisar la cuenta del contrato anterior. Probá de nuevo.").error;
  const charges = (data ?? []) as { id: string; label: string }[];
  if (!charges.length) return null;
  const { data: allocs, error: aErr } = await ctx.admin
    .from("rental_payment_allocations")
    .select("charge_id, source")
    .eq("organization_id", orgId)
    .eq("voided", false)
    .in(
      "charge_id",
      charges.map((c) => c.id),
    );
  // Si no se puede saber de dónde salió la plata, cuenta como cobro.
  const paidDirectly = aErr
    ? new Set(charges.map((c) => c.id))
    : new Set(((allocs ?? []) as { charge_id: string; source: string | null }[]).filter((a) => a.source !== "credit").map((a) => a.charge_id));
  const blocked = charges.filter((c) => paidDirectly.has(c.id));
  if (!blocked.length) return null;
  const prevLabel = formatContractNumber(previous.number);
  const one = blocked.length === 1;
  return `El contrato anterior (${prevLabel}) ya tiene cobrado ${listLabels(blocked.map((c) => c.label))}, y esos meses también los cobra la renovación desde el ${ddmmyyyy(billingFrom)}. Para no cobrarlos dos veces, editá la renovación para que empiece a cobrar después («Se empieza a cobrar desde»), o anulá ${one ? "ese cobro" : "esos cobros"} en el ${prevLabel} y registralo${one ? "" : "s"} en la renovación.`;
}

/**
 * Contrato vencido al que lo sigue su renovación desde el día siguiente al fin:
 * se cierra en su fecha de fin como un traspaso, no como una mudanza. Lo usan
 * el cron (cada noche) y la activación de una renovación que llega tarde.
 */
export async function closeRenewedAtEnd(
  admin: AdminClient,
  contract: RentalContract,
  renewal: { number: number },
  opts: { today: string; actorId?: string | null; actorName?: string | null; settings?: RentalSettings; series?: IndexLookup | null },
): Promise<ContractCloseOut | null> {
  if (contract.status !== "vigente" || contract.terminated_at || contract.end_date >= opts.today) return null;
  const reason = `Renovado por ${formatContractNumber(renewal.number)}`;
  const { data, error } = await admin
    .from("rental_contracts")
    .update({ terminated_at: contract.end_date, termination_reason: reason, ...(opts.actorId ? { updated_by: opts.actorId } : {}) })
    .eq("id", contract.id)
    .eq("organization_id", contract.organization_id)
    .eq("status", "vigente")
    .is("terminated_at", null)
    .select("id");
  if (error) throw new Error(`No se pudo registrar el fin por la renovación: ${error.message}`);
  if (!data?.length) return null;
  // Si lo que sigue falla, queda con la salida registrada y el cron lo retoma (finishContract es idempotente hasta el cambio de estado).
  return finishContract(admin, { ...contract, terminated_at: contract.end_date, termination_reason: reason }, opts);
}

/** Nombre de cada persona de la org (para los mensajes y el historial). */
async function personNames(ctx: RentalsCtx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await ctx.admin.from("rental_people").select("id, full_name").eq("organization_id", ctx.organization.id).in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
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
  /** Lo siguió su renovación: fue un traspaso, no una mudanza (sin cargo de salida; el depósito puede pasar a la renovación). */
  renewal: { id: string; number: number; startDate: string } | null;
}

/**
 * Cierra un contrato cuya salida ya llegó: anula lo facturado para después
 * (devolviendo el saldo a favor imputado), factura lo que falte hasta la
 * salida, cambia el estado y, ya cerrado, pasa los gastos pendientes del
 * inquilino a un cargo de salida. Lo anterior al cambio de estado es
 * idempotente: si algo falla, el contrato sigue vigente y la próxima corrida
 * (cron o pantalla) lo retoma sin duplicar nada. Devuelve null si no había
 * nada que cerrar (u otro proceso lo cerró primero o le cambió la salida).
 *
 * Si lo sigue su renovación desde el día siguiente, el inquilino no se va:
 * los gastos pendientes pasan a la renovación (los cobra con su próximo
 * alquiler) en vez de ir a un cargo de salida, y el depósito queda para
 * pasarlo a la renovación.
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
  const renewal = await renewalTakingOver(admin, contract, endDate);
  const voidReason = renewal ? `Renovado por ${formatContractNumber(renewal.number)}` : status === "rescindido" ? "Contrato rescindido" : "Contrato finalizado";
  const voids = await voidChargesAfter(admin, org, contract.id, endDate, voidReason);
  const settings = opts.settings ?? (await getRentalSettings(admin, org));
  const series = opts.series !== undefined ? opts.series : await loadSeriesForContract(admin, contract);
  const sync = await syncContract(
    admin,
    contract,
    { autoApply: settings.auto_apply_adjustments, leadDays: settings.charge_lead_days },
    { series, today: opts.today, actorId: opts.actorId ?? null },
  );
  // Con la misma salida que se acaba de procesar: si alguien la corrió (o la anuló)
  // mientras tanto, no se cierra; lo anulado se vuelve a generar en la próxima sincronización.
  const { data: closed, error } = await admin
    .from("rental_contracts")
    .update({
      status,
      ...(renewal && !contract.termination_reason ? { termination_reason: voidReason } : {}),
      ...(opts.actorId ? { updated_by: opts.actorId } : {}),
    })
    .eq("id", contract.id)
    .eq("organization_id", org)
    .eq("status", "vigente")
    .eq("terminated_at", endDate)
    .select("id");
  if (error) throw new Error(`No se pudo cerrar el contrato: ${error.message}`);
  if (!closed?.length) return null;

  // Sólo quien ganó el cambio de estado factura los gastos pendientes: dos cierres
  // simultáneos (cron y pantalla) no los cobran dos veces. Si esto falla, los
  // gastos quedan "pendientes" a la vista, para cargarlos a mano.
  let expenses = { total: 0, count: 0, failed: false };
  let movedToRenewal = 0;
  try {
    if (renewal) {
      // Sigue el mismo inquilino: los gastos van con el próximo alquiler de la renovación.
      const { data: moved, error: mvErr } = await admin
        .from("rental_expenses")
        .update({ contract_id: renewal.id })
        .eq("organization_id", org)
        .eq("contract_id", contract.id)
        .eq("charged_to", "inquilino")
        .eq("status", "pendiente")
        .select("id");
      if (mvErr) throw new Error(mvErr.message);
      movedToRenewal = moved?.length ?? 0;
    } else {
      const billed = await billPendingTenantExpenses(admin, contract, {
        dueDate: addDays(maxYmd(endDate, opts.today), contract.payment_window_days || 10),
        actorId: opts.actorId ?? null,
      });
      expenses = { total: billed.total, count: billed.count, failed: false };
      if (billed.chargeId) await applyAvailableCredit(admin, org, contract.id);
    }
  } catch (e) {
    logRentalsError("finishContract:expenses", e);
    expenses = { total: 0, count: 0, failed: true };
  }
  // Lo que de verdad le quedó a favor: la sincronización pudo usar parte en deudas anteriores.
  const creditLeft = voids.creditRestored > 0 ? await unallocatedCreditOf(admin, org, contract.id, contract.currency) : null;

  let keptLabels: string[] = [];
  if (voids.kept.length) {
    const { data: kept } = await admin.from("rental_charges").select("label").eq("organization_id", org).in("id", voids.kept);
    keptLabels = ((kept ?? []) as { label: string }[]).map((k) => k.label);
  }
  const renewalLabel = renewal ? formatContractNumber(renewal.number) : "";
  const parts = [
    renewal
      ? `Contrato ${formatContractNumber(contract.number)} ${status}: siguió con la renovación ${renewalLabel} desde el ${ddmmyyyy(renewal.start_date)}.`
      : `Contrato ${formatContractNumber(contract.number)} ${status}: ${status === "rescindido" ? "desocupó" : "entregó las llaves"} el ${ddmmyyyy(endDate)}.`,
    voids.voided.length ? `Se anul${voids.voided.length === 1 ? "ó 1 cargo" : `aron ${voids.voided.length} cargos`} de meses posteriores.` : null,
    voids.creditRestored > 0
      ? `Se deshicieron ${formatMoney(voids.creditRestored, contract.currency)} de saldo a favor imputado a meses posteriores a la salida${
          creditLeft == null
            ? "."
            : creditLeft > 0.004
              ? `: el inquilino queda con ${formatMoney(creditLeft, contract.currency)} a favor (devolvéselo o aplicalo a lo que deba).`
              : ": se usaron para pagar deudas anteriores."
        }`
      : null,
    expenses.count ? `Gastos sin cobrar: ${formatMoney(expenses.total, contract.currency)} en el cargo «Gastos pendientes».` : null,
    movedToRenewal ? `${movedToRenewal === 1 ? "El gasto pendiente del inquilino pasó" : `Los ${movedToRenewal} gastos pendientes del inquilino pasaron`} a la renovación ${renewalLabel}: se cobran con su próximo alquiler.` : null,
    expenses.failed
      ? renewal
        ? `No se pudieron pasar los gastos pendientes del inquilino a la renovación ${renewalLabel}: cargalos a mano.`
        : "No se pudieron pasar los gastos pendientes del inquilino a un cargo de salida: cargalos a mano."
      : null,
    keptLabels.length ? `Revisá ${keptLabels.join(", ")}: es posterior a la salida y tiene cobros, así que quedó como estaba.` : null,
    renewal && contract.deposit_status === "retenido" && Number(contract.deposit_amount) > 0
      ? `El depósito sigue en garantía: pasalo a la renovación ${renewalLabel} desde «Cerrar el depósito».`
      : null,
  ].filter(Boolean);
  await logRentalEvent(admin, {
    organizationId: org,
    contractId: contract.id,
    propertyId: contract.property_id,
    type: status === "rescindido" ? "contrato_rescindido" : "contrato_finalizado",
    summary: parts.join(" "),
    payload: {
      voided: voids.voided,
      kept: voids.kept,
      credit_restored: voids.creditRestored,
      credit_left: creditLeft,
      expenses_billed: expenses.total,
      ...(renewal ? { renewal_id: renewal.id, expenses_moved: movedToRenewal } : {}),
    },
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
    renewal: renewal ? { id: renewal.id, number: renewal.number, startDate: renewal.start_date } : null,
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

/**
 * Antes de alargar la ocupación de un contrato (una salida posterior a la que
 * tenía, o cobrar la continuación sin fecha): con qué contrato vigente de la
 * propiedad chocaría. null = no choca, o no se alarga (acortar nunca se frena).
 */
async function extensionConflict(ctx: RentalsCtx, contract: RentalContract, newEnd: string | null): Promise<string | null> {
  const current = occupancyEnd(contract);
  if (current === null || (newEnd !== null && newEnd <= current)) return null;
  const conflict = findOccupancyConflict(await vigentesOfProperty(ctx, contract.property_id), {
    selfId: contract.id,
    start: contract.start_date,
    end: newEnd,
  });
  if (!conflict) return null;
  if (conflict.renewed_from_id === contract.id) {
    return `Ya está activa la renovación ${formatContractNumber(conflict.number)}, que empieza el ${ddmmyyyy(conflict.start_date)}: este contrato termina, a más tardar, el ${ddmmyyyy(addDays(conflict.start_date, -1))}.`;
  }
  return `El contrato ${formatContractNumber(conflict.number)} ocupa la propiedad desde el ${ddmmyyyy(conflict.start_date)}: este no puede seguir ${newEnd ? `hasta el ${ddmmyyyy(newEnd)}` : "sin fecha de salida"}. Poné una salida anterior a esa fecha o revisá ese contrato.`;
}

/**
 * Finalizar = registrar la entrega de llaves. Con `continuationBilling`, si el
 * contrato ya venció y no cobraba la continuación, se activa en el mismo paso:
 * así se facturan los meses desde el vencimiento hasta la entrega (art. 1218).
 */
export async function finalizeContract(
  ctx: RentalsCtx,
  contractId: string,
  input: { endedOn: string; reason?: string | null; continuationBilling?: boolean },
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
      error: `Ya tiene la salida registrada para el ${ddmmyyyy(scheduled)} y ese día se cierra solo. Si entregó las llaves antes, poné la fecha real (hoy o antes). Para correrla, usá «Cambiar la salida».`,
      field: "endedOn",
    };
  }
  const conflict = await extensionConflict(ctx, contract, input.endedOn);
  if (conflict) return { ok: false, error: conflict, field: "endedOn" };
  const billContinuation = Boolean(input.continuationBilling) && continuationGap(contract, input.endedOn, ctx.today);
  const reason = input.reason?.trim() || contract.termination_reason || "Fin del contrato";
  const base = ctx.admin
    .from("rental_contracts")
    .update({
      terminated_at: input.endedOn,
      termination_reason: reason,
      ...(billContinuation ? { continuation_billing: true } : {}),
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente");
  const { data: saved, error } = await (scheduled ? base.eq("terminated_at", scheduled) : base.is("terminated_at", null)).select("id");
  if (error) {
    if (isOverlapError(error)) return { ok: false, error: await overlapMessage(ctx, contract.property_id, { selfId: contract.id, start: contract.start_date, end: input.endedOn }) };
    return dbFailure("finalizeContract", error, "No se pudo finalizar el contrato.");
  }
  if (!saved?.length) return { ok: false, error: "El contrato cambió mientras tanto. Recargá y probá de nuevo." };
  const continuationNote = billContinuation
    ? ` Se cobran también los meses desde el vencimiento (${ddmmyyyy(contract.end_date)}) hasta la entrega, al último alquiler (continuación, art. 1218 CCyC).`
    : "";

  if (input.endedOn > ctx.today) {
    await scheduleExit(ctx, contractId, input.endedOn, "Contrato finalizado");
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId,
      propertyId: contract.property_id,
      type: "contrato_salida_programada",
      summary: `Entrega de llaves programada para el ${ddmmyyyy(input.endedOn)} (${reason}). Hasta ese día sigue vigente y se le sigue cobrando; después se finaliza solo.${continuationNote}`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
    return { ok: true, closesOn: input.endedOn };
  }
  if (continuationNote) {
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId,
      propertyId: contract.property_id,
      type: "continuacion_activada",
      summary: `Al registrar la entrega del ${ddmmyyyy(input.endedOn)}:${continuationNote}`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }
  try {
    await finishContract(
      ctx.admin,
      { ...contract, terminated_at: input.endedOn, termination_reason: reason, ...(billContinuation ? { continuation_billing: true } : {}) },
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
  input: { noticeDate: string; moveOutDate: string; reason: string; penaltyAmount: number; chargePenalty: boolean; continuationBilling?: boolean },
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
      error: `Ya hay una salida registrada para este contrato (desocupa el ${ddmmyyyy(contract.terminated_at)}): no se puede registrar otra rescisión. Para correr la fecha o anularla, usá «Cambiar la salida».`,
    };
  }
  if (input.moveOutDate < contract.start_date) return { ok: false, error: "La desocupación no puede ser anterior al inicio del contrato." };
  const conflict = await extensionConflict(ctx, contract, input.moveOutDate);
  if (conflict) return { ok: false, error: conflict };
  // Vencido sin cobrar la continuación: los meses hasta que desocupa se cobran sólo si la persona lo pidió.
  const billContinuation = Boolean(input.continuationBilling) && continuationGap(contract, input.moveOutDate, ctx.today);
  const penalty = round2(Math.max(0, input.penaltyAmount || 0));
  const reason = input.reason.trim() || "Rescisión anticipada";
  const { data: saved, error } = await ctx.admin
    .from("rental_contracts")
    .update({
      terminated_at: input.moveOutDate,
      termination_notice_date: input.noticeDate,
      termination_reason: reason,
      termination_penalty: penalty,
      ...(billContinuation ? { continuation_billing: true } : {}),
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente")
    .is("terminated_at", null)
    .select("id");
  if (error) {
    if (isOverlapError(error)) return { ok: false, error: await overlapMessage(ctx, contract.property_id, { selfId: contract.id, start: contract.start_date, end: input.moveOutDate }) };
    return dbFailure("rescindContract", error, "No se pudo rescindir el contrato.");
  }
  if (!saved?.length) return { ok: false, error: "El contrato cambió mientras tanto. Recargá y probá de nuevo." };
  const continuationNote = billContinuation
    ? ` Se cobran también los meses desde el vencimiento (${ddmmyyyy(contract.end_date)}) hasta que desocupa, al último alquiler (continuación, art. 1218 CCyC).`
    : "";

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
    summary: `Rescisión: notificó el ${ddmmyyyy(input.noticeDate)}, desocupa el ${ddmmyyyy(input.moveOutDate)}${penalty > 0 ? ` · indemnización ${formatMoney(penalty, contract.currency)}` : ""}.${future ? " Hasta ese día sigue vigente y se le sigue cobrando el alquiler; después se cierra solo." : ""}${continuationNote}`,
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
      {
        ...contract,
        terminated_at: input.moveOutDate,
        termination_notice_date: input.noticeDate,
        termination_reason: reason,
        termination_penalty: penalty,
        ...(billContinuation ? { continuation_billing: true } : {}),
      },
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
 *
 * Con la salida registrada se cobra hasta esa fecha. Con la renovación activa
 * los meses los cobra ella: si arranca al día siguiente del fin no hay nada
 * que cobrar acá; si deja un hueco, se cobra sólo hasta el día anterior a que
 * empiece (se le registra esa salida). Tampoco se enciende si otro contrato
 * vigente ya ocupa la propiedad después del fin: serían dos inquilinos
 * facturados por los mismos meses.
 */
export async function setContinuationBilling(ctx: RentalsCtx, contractId: string, on: boolean): Promise<ActionResult<{ created: number }>> {
  const orgId = ctx.organization.id;
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("*")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  if (contract.status !== "vigente") return { ok: false, error: "Sólo un contrato vigente puede cobrar meses de continuación." };
  if (on && contract.end_date >= ctx.today) {
    return { ok: false, error: `El contrato todavía no venció (termina el ${ddmmyyyy(contract.end_date)}): los meses de continuación se cobran recién después.` };
  }
  if (Boolean(contract.continuation_billing) === on) return { ok: true, created: 0 };
  let bound: { date: string; reason: string; renewal: string } | null = null;
  if (on) {
    const { data: ren, error: renErr } = await ctx.admin
      .from("rental_contracts")
      .select("id, number, start_date")
      .eq("organization_id", orgId)
      .eq("renewed_from_id", contract.id)
      .eq("property_id", contract.property_id)
      .neq("status", "borrador")
      .order("start_date", { ascending: true })
      .limit(1);
    if (renErr) return dbFailure("setContinuationBilling:renewal", renErr, "No se pudo revisar la renovación del contrato. Probá de nuevo.");
    const renewal = ((ren ?? []) as { id: string; number: number; start_date: string }[])[0];
    if (renewal) {
      const renLabel = formatContractNumber(renewal.number);
      if (isRenewalHandover(contract.end_date, renewal.start_date)) {
        return { ok: false, error: `Ya está activa la renovación ${renLabel} desde el ${ddmmyyyy(renewal.start_date)}: los meses después del vencimiento los cobra ella, no este contrato.` };
      }
      const lastDay = addDays(renewal.start_date, -1);
      if (!contract.terminated_at || contract.terminated_at > lastDay) bound = { date: lastDay, reason: `Renovado por ${renLabel}`, renewal: renLabel };
    }
    const conflict = await extensionConflict(ctx, contract, bound?.date ?? contract.terminated_at ?? null);
    if (conflict) return { ok: false, error: conflict };
  }
  const base = ctx.admin
    .from("rental_contracts")
    .update({
      continuation_billing: on,
      ...(bound ? { terminated_at: bound.date, termination_reason: bound.reason } : {}),
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .eq("status", "vigente")
    .eq("continuation_billing", !on);
  const { data: saved, error } = await (bound
    ? contract.terminated_at
      ? base.eq("terminated_at", contract.terminated_at)
      : base.is("terminated_at", null)
    : base
  ).select("id");
  if (error) {
    if (isOverlapError(error)) return { ok: false, error: await overlapMessage(ctx, contract.property_id, { selfId: contract.id, start: contract.start_date, end: bound?.date ?? contract.terminated_at ?? null }) };
    return dbFailure("setContinuationBilling", error, "No se pudo cambiar el cobro de la continuación.");
  }
  if (!saved?.length) return { ok: false, error: "El contrato cambió mientras tanto. Recargá y probá de nuevo." };
  let created = 0;
  if (on) {
    try {
      const fresh: RentalContract = { ...contract, continuation_billing: true, ...(bound ? { terminated_at: bound.date, termination_reason: bound.reason } : {}) };
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
      ? `Se activó el cobro de los meses de continuación (art. 1218 CCyC): se facturan al último alquiler, sin ajustes nuevos.${bound ? ` Hasta el ${ddmmyyyy(bound.date)}: desde el día siguiente cobra la renovación ${bound.renewal}.` : ""}${created ? ` Se ${created === 1 ? "generó 1 cargo" : `generaron ${created} cargos`}.` : ""}`
      : "Se desactivó el cobro de los meses de continuación: no se generan más cargos después del fin. Los que ya estaban siguen en la cuenta.",
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, created };
}

// ─── Cambiar la salida ──────────────────────────────────────────────────────

/**
 * Corre o anula una salida ya registrada (rescisión notificada o entrega
 * programada). Sin esto, si el inquilino pedía quedarse unas semanas más o se
 * arrepentía, el cron lo cerraba igual el día anotado: anulaba los meses
 * siguientes y dejaba de cobrar con el inquilino adentro.
 *   - Correrla más tarde: los meses hasta la fecha nueva se vuelven a facturar.
 *     Adelantarla: se anulan los posteriores, como al registrarla.
 *   - Anularla: vuelve a regir como antes (hasta su fin, o como vencido). La
 *     indemnización se anula si no tiene cobros; si ya se cobró, queda y se avisa.
 * `expected` es la salida que vio la persona: si cambió mientras tanto, no se pisa.
 * Con `continuationBilling`, un vencido que no la cobraba la empieza a cobrar.
 */
export async function changeContractExit(
  ctx: RentalsCtx,
  contractId: string,
  input: { expected: string; newDate: string | null; continuationBilling?: boolean },
): Promise<ActionResult<{ closesOn: string | null; notice: string | null }>> {
  const orgId = ctx.organization.id;
  const newDate = input.newDate;
  if (!isYmd(input.expected) || (newDate !== null && !isYmd(newDate))) return { ok: false, error: "Revisá la fecha.", field: "newDate" };
  const { data } = await ctx.admin.from("rental_contracts").select("*").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };
  const old = contract.terminated_at;
  if (contract.status !== "vigente" || !old) return { ok: false, error: "Este contrato no tiene una salida registrada para cambiar." };
  if (old !== input.expected) return { ok: false, error: "La salida cambió mientras tanto. Recargá y probá de nuevo." };
  if (newDate !== null) {
    if (newDate === old) return { ok: true, closesOn: old, notice: null };
    if (newDate <= ctx.today) {
      return { ok: false, error: "Para una fecha de hoy o anterior usá «Registrar entrega de llaves»: la cuenta se cierra en el momento.", field: "newDate" };
    }
  }
  // La salida que puso la renovación (el día antes de que empiece) no se mueve desde acá.
  const { data: ren, error: renErr } = await ctx.admin
    .from("rental_contracts")
    .select("number, start_date")
    .eq("organization_id", orgId)
    .eq("renewed_from_id", contract.id)
    .eq("property_id", contract.property_id)
    .neq("status", "borrador")
    .order("start_date", { ascending: true })
    .limit(1);
  if (renErr) return dbFailure("changeContractExit:renewal", renErr, "No se pudo revisar la renovación del contrato. Probá de nuevo.");
  const renewal = ((ren ?? []) as { number: number; start_date: string }[])[0];
  if (renewal && isRenewalHandover(old, renewal.start_date)) {
    return {
      ok: false,
      error: `Esta salida la pone la renovación ${formatContractNumber(renewal.number)}, que empieza el ${ddmmyyyy(renewal.start_date)}: este contrato termina el día anterior. Si cambió la fecha de la renovación, revisala desde su ficha.`,
    };
  }
  const billContinuation = Boolean(input.continuationBilling) && continuationGap(contract, newDate, ctx.today);
  const after = { ...contract, terminated_at: newDate, continuation_billing: contract.continuation_billing || billContinuation };
  const conflict = await extensionConflict(ctx, contract, occupancyEnd(after));
  if (conflict) return { ok: false, error: conflict, field: "newDate" };

  const withdraw = newDate === null;
  const rescission = Boolean(contract.termination_notice_date);
  const { data: saved, error } = await ctx.admin
    .from("rental_contracts")
    .update({
      ...(withdraw
        ? { terminated_at: null, termination_notice_date: null, termination_reason: null, termination_penalty: null }
        : { terminated_at: newDate }),
      ...(billContinuation ? { continuation_billing: true } : {}),
      updated_by: ctx.session.userId,
    })
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .eq("status", "vigente")
    .eq("terminated_at", old)
    .select("id");
  if (error) {
    if (isOverlapError(error)) return { ok: false, error: await overlapMessage(ctx, contract.property_id, { selfId: contract.id, start: contract.start_date, end: occupancyEnd(after) }) };
    return dbFailure("changeContractExit", error, "No se pudo cambiar la salida.");
  }
  if (!saved?.length) return { ok: false, error: "La salida cambió mientras tanto. Recargá y probá de nuevo." };

  // Anulada la rescisión, la indemnización ya no corresponde: se anula si nadie la pagó.
  let notice: string | null = null;
  let penaltyNote = "";
  let creditRestored = 0;
  if (withdraw && rescission) {
    try {
      const { data: rows, error: penErr } = await ctx.admin
        .from("rental_charges")
        .select("id, items:rental_charge_items(kind)")
        .eq("organization_id", orgId)
        .eq("contract_id", contractId)
        .eq("kind", "salida")
        .is("voided_at", null);
      if (penErr) throw new Error(penErr.message);
      const ids = ((rows ?? []) as { id: string; items: { kind: string }[] | null }[]).filter((r) => (r.items ?? []).some((i) => i.kind === "rescision")).map((r) => r.id);
      if (ids.length) {
        const res = await voidContractCharges(ctx.admin, orgId, contractId, ids, "Se anuló la rescisión", { undoCredit: true });
        if (res.voided.length) penaltyNote = " Se anuló la indemnización.";
        creditRestored = res.creditRestored;
        if (res.kept.length) {
          notice = "La indemnización ya tiene cobros, así que quedó en la cuenta: si hay que devolverla, anulá el cobro y después el cargo.";
          penaltyNote += " La indemnización ya tenía cobros y quedó en la cuenta.";
        }
      }
    } catch (e) {
      logRentalsError("changeContractExit:penalty", e);
      notice = "No se pudo anular la indemnización: anulala a mano desde la cuenta del contrato.";
      penaltyNote = " No se pudo anular la indemnización.";
    }
  }

  // Adelantada: se anula lo posterior. Corrida o anulada: la sincronización vuelve a facturar los meses que faltan.
  if (newDate !== null && newDate < old) await scheduleExit(ctx, contractId, newDate, rescission ? "Contrato rescindido" : "Contrato finalizado");
  else await resyncContract(ctx, contractId);

  // El saldo que volvió de la indemnización: la sincronización pudo aplicarlo a los meses que se vuelven a cobrar.
  if (creditRestored > 0) {
    const left = await unallocatedCreditOf(ctx.admin, orgId, contractId, contract.currency);
    penaltyNote += ` Se deshicieron ${formatMoney(creditRestored, contract.currency)} de saldo a favor imputado a la indemnización${
      left == null
        ? "."
        : left > 0.004
          ? `: el inquilino queda con ${formatMoney(left, contract.currency)} a favor.`
          : ": se aplicaron a los meses que se vuelven a cobrar."
    }`;
  }

  const continuationNote = billContinuation
    ? ` Se cobran los meses desde el vencimiento (${ddmmyyyy(contract.end_date)}), al último alquiler (continuación, art. 1218 CCyC).`
    : "";
  const what = rescission ? "la rescisión" : "la entrega programada";
  await logRentalEvent(ctx.admin, {
    organizationId: orgId,
    contractId,
    propertyId: contract.property_id,
    type: withdraw ? "contrato_salida_anulada" : "contrato_salida_cambiada",
    summary: withdraw
      ? `Se anuló ${what} del ${ddmmyyyy(old)}: el inquilino se queda y el contrato sigue ${contract.end_date < ctx.today ? `como vencido (terminó el ${ddmmyyyy(contract.end_date)})` : `hasta su fin (${ddmmyyyy(contract.end_date)})`}.${penaltyNote}${continuationNote}`
      : `La salida pasó del ${ddmmyyyy(old)} al ${ddmmyyyy(newDate as string)}: ${(newDate as string) > old ? "se vuelven a facturar los meses hasta la fecha nueva" : "se anularon los cargos posteriores"}.${contract.termination_penalty ? " La indemnización no se recalculó: si cambia, corregila desde la cuenta." : ""}${continuationNote}`,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, closesOn: newDate, notice };
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
