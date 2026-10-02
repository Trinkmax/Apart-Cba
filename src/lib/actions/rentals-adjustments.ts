"use server";

import { z } from "zod";
import type { RentalAdjustmentMethod, RentalAdjustmentStatus, RentalProperty } from "@/lib/types/database";
import { formatContractNumber, propertyAddress } from "@/lib/rentals/labels";
import { adjustmentCount } from "@/lib/rentals/schedule";
import { addDays } from "@/lib/rentals/ymd";
import { ymdInTz } from "@/lib/dates";
import { dbFailure, logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { logRentalEvent } from "@/lib/rentals/server/contract-sync";
import { resyncContract } from "@/lib/rentals/server/contracts";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { sendGuestMail } from "@/lib/email/guest";
import { buildAdjustmentEmail } from "@/lib/email/rentals-adjustments";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { adjustmentActions, effectiveVariation, isOverridden, newAmountOf, type AdjustmentView } from "@/components/rentals/adjustments/adjustment-view";
import { adjustmentWhatsappText, formatVariation, plainMoney, shortDate, type NoticeInput } from "@/components/rentals/adjustments/adjustment-text";

/**
 * Ajustes de alquiler: listar (pantalla /ajustes y ficha del contrato),
 * aplicar los que quedaron "listos" (cuando el aplicar automático está
 * apagado), corregir el monto, no aplicar, volver al cálculo y avisar al
 * inquilino. Después de cada cambio de plata se re-sincroniza el contrato
 * (`resyncContract`: alquiler vigente, cargos y diferencias).
 */

const ADJ_SELECT = `id, contract_id, sequence, effective_date, status, method, index_code, from_key, to_key, from_value, to_value,
  coefficient, variation_pct, base_amount, computed_amount, applied_amount, override_reason, applied_at, notified_at, notified_via,
  contract:rental_contracts!inner(id, number, status, currency, duration_months, adjustment_every_months, fixed_pct, property_id,
    property:rental_properties(street, street_number, floor, apartment, tower),
    parties:rental_contract_parties(role, is_primary, person:rental_people(full_name, email, phone)))`;

type PropertyLite = Pick<RentalProperty, "street" | "street_number" | "floor" | "apartment" | "tower">;
type PartyLite = { role: string; is_primary: boolean; person: { full_name: string; email: string | null; phone: string | null } | null };

interface AdjRow {
  id: string;
  contract_id: string;
  sequence: number;
  effective_date: string;
  status: RentalAdjustmentStatus;
  method: RentalAdjustmentMethod;
  index_code: string | null;
  from_key: string | null;
  to_key: string | null;
  from_value: number | string | null;
  to_value: number | string | null;
  coefficient: number | string | null;
  variation_pct: number | string | null;
  base_amount: number | string | null;
  computed_amount: number | string | null;
  applied_amount: number | string | null;
  override_reason: string | null;
  applied_at: string | null;
  notified_at: string | null;
  notified_via: string | null;
  contract: {
    id: string;
    number: number;
    status: string;
    currency: string;
    duration_months: number;
    adjustment_every_months: number | null;
    fixed_pct: number | string | null;
    property_id: string;
    property: PropertyLite | null;
    parties: PartyLite[] | null;
  };
}

const num = (v: number | string | null | undefined): number | null => (v == null || v === "" ? null : Number(v));

function primaryTenant(parties: PartyLite[] | null): PartyLite["person"] {
  const tenants = (parties ?? []).filter((p) => p.role === "inquilino" && p.person);
  return (tenants.find((p) => p.is_primary) ?? tenants[0])?.person ?? null;
}

/** `tz`: zona de la organización, para mostrar el día del aviso (timestamptz) en hora local. */
function toView(r: AdjRow, tz: string): AdjustmentView {
  const c = r.contract;
  const tenant = primaryTenant(c.parties);
  return {
    id: r.id,
    contractId: r.contract_id,
    contractNumber: c.number,
    contractStatus: c.status,
    address: c.property ? propertyAddress(c.property) : "Propiedad",
    tenantName: tenant?.full_name ?? null,
    tenantEmail: tenant?.email ?? null,
    tenantPhone: tenant?.phone ?? null,
    currency: c.currency,
    sequence: r.sequence,
    totalAdjustments: adjustmentCount(c.duration_months, c.adjustment_every_months),
    effectiveDate: r.effective_date,
    status: r.status,
    method: r.method,
    indexCode: r.index_code,
    every: c.adjustment_every_months,
    fixedPct: num(c.fixed_pct),
    fromKey: r.from_key,
    toKey: r.to_key,
    fromValue: num(r.from_value),
    toValue: num(r.to_value),
    coefficient: num(r.coefficient),
    variationPct: num(r.variation_pct),
    baseAmount: num(r.base_amount),
    computedAmount: num(r.computed_amount),
    appliedAmount: num(r.applied_amount),
    overrideReason: r.override_reason,
    appliedAt: r.applied_at,
    notifiedAt: r.notified_at,
    notifiedOn: r.notified_at ? ymdInTz(new Date(r.notified_at), tz) : null,
    notifiedVia: r.notified_via,
  };
}

export type AdjustmentWindowKey = "proximos" | "pendientes" | "aplicados";

const PENDING: RentalAdjustmentStatus[] = ["pendiente_indice", "pendiente_manual", "calculado"];

function baseQuery(ctx: RentalsCtx, select: string, opts?: { count: "exact"; head: true }) {
  return ctx.admin.from("rental_adjustments").select(select, opts).eq("organization_id", ctx.organization.id);
}

export async function listAdjustments(opts: { window: AdjustmentWindowKey }): Promise<
  ActionResult<{ items: AdjustmentView[]; counts: { proximos: number; pendientes: number; sinAviso: number }; today: string }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const { today } = ctx;
  const window: AdjustmentWindowKey = ["proximos", "pendientes", "aplicados"].includes(opts?.window) ? opts.window : "proximos";
  const in60 = addDays(today, 60);

  let q = baseQuery(ctx, ADJ_SELECT);
  if (window === "proximos") {
    q = q.gte("effective_date", today).lte("effective_date", in60).neq("status", "omitido").eq("contract.status", "vigente").order("effective_date", { ascending: true });
  } else if (window === "pendientes") {
    q = q.in("status", PENDING).eq("contract.status", "vigente").order("effective_date", { ascending: true });
  } else {
    q = q.in("status", ["aplicado", "omitido"]).neq("contract.status", "borrador").gte("effective_date", addDays(today, -180)).order("effective_date", { ascending: false });
  }
  const head = { count: "exact" as const, head: true as const };
  const lite = "id, contract:rental_contracts!inner(status)";
  const [list, proximos, pendientes, sinAviso] = await Promise.all([
    q.limit(200),
    baseQuery(ctx, lite, head).gte("effective_date", today).lte("effective_date", in60).neq("status", "omitido").eq("contract.status", "vigente"),
    baseQuery(ctx, lite, head).in("status", PENDING).eq("contract.status", "vigente"),
    baseQuery(ctx, lite, head)
      .eq("status", "aplicado")
      .is("notified_at", null)
      .gte("effective_date", addDays(today, -15))
      .lte("effective_date", in60)
      .eq("contract.status", "vigente"),
  ]);
  if (list.error) return dbFailure("listAdjustments", list.error, "No se pudieron leer los ajustes.");
  return {
    ok: true,
    items: ((list.data ?? []) as unknown as AdjRow[]).map((row) => toView(row, ctx.tz)),
    counts: { proximos: proximos.count ?? 0, pendientes: pendientes.count ?? 0, sinAviso: sinAviso.count ?? 0 },
    today,
  };
}

export interface ContractAdjustmentsSummary {
  id: string;
  status: string;
  method: RentalAdjustmentMethod;
  indexCode: string | null;
  every: number | null;
  lagMonths: number;
  fixedPct: number | null;
  currentRent: number;
  initialRent: number;
  currency: string;
  startDate: string;
}

/** Todos los ajustes de UN contrato (historial + próximos) para su pestaña "Ajustes". */
export async function listContractAdjustments(contractId: string): Promise<
  ActionResult<{ contract: ContractAdjustmentsSummary; items: AdjustmentView[]; today: string }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!z.string().uuid().safeParse(contractId).success) return { ok: false, error: "Contrato inválido." };
  const [contractRes, adjRes] = await Promise.all([
    ctx.admin
      .from("rental_contracts")
      .select("id, status, adjustment_method, index_code, adjustment_every_months, index_lag_months, fixed_pct, current_rent, initial_rent, currency, start_date")
      .eq("organization_id", ctx.organization.id)
      .eq("id", contractId)
      .maybeSingle(),
    baseQuery(ctx, ADJ_SELECT).eq("contract_id", contractId).order("sequence", { ascending: true }),
  ]);
  if (contractRes.error) return dbFailure("listContractAdjustments", contractRes.error, "No se pudo leer el contrato.");
  if (!contractRes.data) return { ok: false, error: "No encontramos el contrato." };
  if (adjRes.error) return dbFailure("listContractAdjustments", adjRes.error, "No se pudieron leer los ajustes.");
  const c = contractRes.data as {
    id: string; status: string; adjustment_method: RentalAdjustmentMethod; index_code: string | null; adjustment_every_months: number | null;
    index_lag_months: number; fixed_pct: number | string | null; current_rent: number | string; initial_rent: number | string; currency: string; start_date: string;
  };
  return {
    ok: true,
    today: ctx.today,
    contract: {
      id: c.id,
      status: c.status,
      method: c.adjustment_method,
      indexCode: c.index_code,
      every: c.adjustment_every_months,
      lagMonths: c.index_lag_months,
      fixedPct: num(c.fixed_pct),
      currentRent: Number(c.current_rent),
      initialRent: Number(c.initial_rent),
      currency: c.currency,
      startDate: c.start_date,
    },
    items: ((adjRes.data ?? []) as unknown as AdjRow[]).map((row) => toView(row, ctx.tz)),
  };
}

// ─── Cambios ────────────────────────────────────────────────────────────────

async function loadAdjustment(ctx: RentalsCtx, id: string): Promise<AdjRow | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await baseQuery(ctx, ADJ_SELECT).eq("id", id).maybeSingle();
  if (error) {
    logRentalsError("loadAdjustment", error);
    return null;
  }
  return (data as unknown as AdjRow) ?? null;
}

const NOT_FOUND = { ok: false as const, error: "No encontramos el ajuste. Actualizá la página." };
const RACE = { ok: false as const, error: "Alguien cambió este ajuste recién. Actualizá la página y volvé a intentar." };

async function afterChange(ctx: RentalsCtx, row: AdjRow, type: string, summary: string, payload: Record<string, unknown>) {
  await resyncContract(ctx, row.contract_id);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: row.contract_id,
    propertyId: row.contract.property_id,
    type,
    summary,
    payload: { adjustment_id: row.id, sequence: row.sequence, ...payload },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: row.contract_id, propertyId: row.contract.property_id });
}

/** Aplica un ajuste "listo para aplicar" con el monto calculado. */
export async function applyAdjustment(id: string): Promise<ActionResult<{ amount: number }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const row = await loadAdjustment(ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, ctx.tz);
  if (!adjustmentActions(v).apply) {
    return { ok: false, error: v.status === "aplicado" ? "Ese ajuste ya está aplicado." : "Ese ajuste todavía no se puede aplicar." };
  }
  const amount = v.computedAmount;
  if (!amount || amount <= 0) return { ok: false, error: "El ajuste no tiene monto calculado." };
  const { data, error } = await ctx.admin
    .from("rental_adjustments")
    .update({ status: "aplicado", applied_amount: amount, applied_at: new Date().toISOString(), applied_by: ctx.session.userId })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .eq("status", "calculado")
    .select("id");
  if (error) return dbFailure("applyAdjustment", error, "No se pudo aplicar el ajuste.");
  if (!data?.length) return RACE;
  const base = v.baseAmount != null ? `${plainMoney(v.baseAmount, v.currency)} → ` : "";
  await afterChange(
    ctx,
    row,
    "ajuste_aplicado",
    `Ajuste ${v.sequence} aplicado: ${base}${plainMoney(amount, v.currency)} (${formatVariation(v.variationPct)}) desde el ${shortDate(v.effectiveDate)}`,
    { amount, variation_pct: v.variationPct },
  );
  return { ok: true, amount };
}

const overrideSchema = z.object({
  amount: z.coerce.number({ invalid_type_error: "Ingresá el monto" }).positive("El monto tiene que ser mayor a cero").max(10_000_000_000, "Revisá el monto"),
  reason: z.string().trim().min(3, "Contá en pocas palabras por qué (queda en el historial)").max(300, "Máximo 300 caracteres"),
});

/** Fija a mano el monto que rige desde el ajuste (acuerdo con el inquilino, índice discutido, monto manual). */
export async function overrideAdjustment(
  id: string,
  input: { amount: number; reason: string },
): Promise<ActionResult<{ amount: number; retroactive: boolean }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Revisá los datos.", field: first?.path?.[0]?.toString() };
  }
  const row = await loadAdjustment(ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, ctx.tz);
  if (!adjustmentActions(v).override) return { ok: false, error: "Este ajuste no se puede corregir." };
  const { amount, reason } = parsed.data;
  const { data, error } = await ctx.admin
    .from("rental_adjustments")
    .update({ status: "aplicado", applied_amount: amount, override_reason: reason, applied_at: new Date().toISOString(), applied_by: ctx.session.userId })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .neq("status", "omitido")
    .select("id");
  if (error) return dbFailure("overrideAdjustment", error, "No se pudo guardar el monto.");
  if (!data?.length) return RACE;
  const calc = v.computedAmount != null ? ` (cálculo: ${plainMoney(v.computedAmount, v.currency)})` : "";
  await afterChange(ctx, row, "ajuste_corregido", `Ajuste ${v.sequence} fijado a mano en ${plainMoney(amount, v.currency)}${calc}. Motivo: ${reason}`, {
    amount,
    computed_amount: v.computedAmount,
    reason,
  });
  return { ok: true, amount, retroactive: v.effectiveDate <= ctx.today };
}

/** Decide no aplicar un ajuste: el precio sigue igual y el siguiente ajuste parte de ahí. */
export async function skipAdjustment(id: string, reason: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3) return { ok: false, error: "Contá en pocas palabras por qué no se aplica (queda en el historial).", field: "reason" };
  if (why.length > 300) return { ok: false, error: "Máximo 300 caracteres.", field: "reason" };
  const row = await loadAdjustment(ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, ctx.tz);
  if (!adjustmentActions(v).skip) return { ok: false, error: "Este ajuste ya está aplicado: si el monto no corresponde, corregilo." };
  const { data, error } = await ctx.admin
    .from("rental_adjustments")
    .update({ status: "omitido", applied_amount: null, override_reason: why, applied_at: new Date().toISOString(), applied_by: ctx.session.userId })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .in("status", ["programado", "pendiente_indice", "pendiente_manual", "calculado"])
    .select("id");
  if (error) return dbFailure("skipAdjustment", error, "No se pudo marcar el ajuste.");
  if (!data?.length) return RACE;
  await afterChange(ctx, row, "ajuste_omitido", `Ajuste ${v.sequence} (desde el ${shortDate(v.effectiveDate)}) no se aplica. Motivo: ${why}`, { reason: why });
  return { ok: true };
}

/** Deshace una corrección o un "no aplicar": el ajuste vuelve a calcularse con el índice. */
export async function reopenAdjustment(id: string): Promise<ActionResult> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const row = await loadAdjustment(ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, ctx.tz);
  if (!adjustmentActions(v).reopen) return { ok: false, error: "Este ajuste ya sigue el cálculo." };
  const { data, error } = await ctx.admin
    .from("rental_adjustments")
    .update({ status: "programado", applied_amount: null, override_reason: null, applied_at: null, applied_by: null })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .in("status", ["aplicado", "omitido"])
    .select("id");
  if (error) return dbFailure("reopenAdjustment", error, "No se pudo volver al cálculo.");
  if (!data?.length) return RACE;
  await afterChange(ctx, row, "ajuste_reabierto", `Ajuste ${v.sequence} vuelve a seguir el cálculo del índice`, {
    previous_status: v.status,
    previous_amount: newAmountOf(v),
    was_overridden: isOverridden(v),
  });
  return { ok: true };
}

// ─── Avisos al inquilino ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function noticeInputOf(v: AdjustmentView): NoticeInput | null {
  const newAmount = newAmountOf(v);
  if (newAmount == null || v.baseAmount == null) return null;
  return {
    method: v.method,
    index_code: v.indexCode,
    from_key: v.fromKey,
    to_key: v.toKey,
    effectiveDate: v.effectiveDate,
    oldAmount: v.baseAmount,
    newAmount,
    currency: v.currency,
    variationPct: effectiveVariation(v),
    fixedPct: v.fixedPct,
    overridden: isOverridden(v),
  };
}

function whatsappOf(ctx: RentalsCtx, v: AdjustmentView, n: NoticeInput): { text: string; url: string | null } {
  const text = adjustmentWhatsappText({ ...n, tenantName: v.tenantName, orgName: ctx.organization.name, address: v.address });
  const digits = toWhatsappDigits(v.tenantPhone);
  return { text, url: /^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null };
}

async function nextAdjustmentDate(ctx: RentalsCtx, v: AdjustmentView): Promise<string | null> {
  const { data } = await ctx.admin
    .from("rental_adjustments")
    .select("effective_date")
    .eq("organization_id", ctx.organization.id)
    .eq("contract_id", v.contractId)
    .eq("sequence", v.sequence + 1)
    .maybeSingle();
  return (data as { effective_date: string } | null)?.effective_date ?? null;
}

async function sendNoticeMail(ctx: RentalsCtx, v: AdjustmentView, n: NoticeInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!v.tenantEmail || !EMAIL_RE.test(v.tenantEmail)) return { ok: false, error: "El inquilino no tiene un mail cargado. Mandale el aviso por WhatsApp o cargá su mail." };
  const org = ctx.organization;
  const mail = buildAdjustmentEmail({
    orgName: org.name,
    brandColor: org.primary_color,
    logoUrl: org.logo_url,
    contactPhone: org.contact_phone,
    contactEmail: org.contact_email,
    tenantName: v.tenantName,
    address: v.address,
    contractNumber: v.contractNumber,
    notice: n,
    nextAdjustmentDate: await nextAdjustmentDate(ctx, v),
  });
  const res = await sendGuestMail({
    organizationId: org.id,
    to: v.tenantEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(org.contact_email ? { replyTo: org.contact_email } : {}),
  });
  if (!res.ok) {
    logRentalsError("sendNoticeMail", res.error);
    return { ok: false, error: "No se pudo mandar el mail. Probá de nuevo en un rato o avisale por WhatsApp." };
  }
  return { ok: true };
}

async function markNotified(ctx: RentalsCtx, row: AdjRow, via: "email" | "whatsapp"): Promise<void> {
  const { error } = await ctx.admin
    .from("rental_adjustments")
    .update({ notified_at: new Date().toISOString(), notified_via: via })
    .eq("id", row.id)
    .eq("organization_id", ctx.organization.id);
  if (error) logRentalsError("markNotified", error);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: row.contract_id,
    propertyId: row.contract.property_id,
    type: "ajuste_avisado",
    summary: `Aviso del ajuste ${row.sequence} al inquilino por ${via === "email" ? "mail" : "WhatsApp"}`,
    payload: { adjustment_id: row.id, via },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
}

/** Texto del aviso (para mostrar y copiar) sin marcar nada. */
export async function getAdjustmentNotice(id: string): Promise<
  ActionResult<{ whatsappText: string; whatsappUrl: string | null; email: string | null; phone: string | null }>
> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const row = await loadAdjustment(r.ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, r.ctx.tz);
  const n = noticeInputOf(v);
  if (!n) return { ok: false, error: "Este ajuste todavía no tiene monto para avisar." };
  const wa = whatsappOf(r.ctx, v, n);
  return { ok: true, whatsappText: wa.text, whatsappUrl: wa.url, email: v.tenantEmail, phone: v.tenantPhone };
}

/** Avisa el alquiler nuevo: por mail (lo manda) o por WhatsApp (devuelve el texto y el link) y lo marca avisado. */
export async function notifyAdjustment(
  id: string,
  opts: { channel: "email" | "whatsapp" },
): Promise<ActionResult<{ channel: "email" | "whatsapp"; whatsappText?: string; whatsappUrl?: string | null; sentTo?: string }>> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const row = await loadAdjustment(ctx, id);
  if (!row) return NOT_FOUND;
  const v = toView(row, ctx.tz);
  if (!adjustmentActions(v).notify) return { ok: false, error: "Sólo se avisan los ajustes aplicados." };
  const n = noticeInputOf(v);
  if (!n) return { ok: false, error: "Este ajuste todavía no tiene monto para avisar." };
  if (opts?.channel === "email") {
    const sent = await sendNoticeMail(ctx, v, n);
    if (!sent.ok) return sent;
    await markNotified(ctx, row, "email");
    revalidateRentals({ contractId: v.contractId });
    return { ok: true, channel: "email", sentTo: v.tenantEmail ?? undefined };
  }
  const wa = whatsappOf(ctx, v, n);
  await markNotified(ctx, row, "whatsapp");
  revalidateRentals({ contractId: v.contractId });
  return { ok: true, channel: "whatsapp", whatsappText: wa.text, whatsappUrl: wa.url };
}

/** "Avisar a todos": manda el mail de cada ajuste aplicado que todavía no se avisó. */
export async function notifyAllApplied(): Promise<
  ActionResult<{ sent: number; failed: number; withoutEmail: { id: string; contractId: string; contractNumber: string; tenantName: string | null }[] }>
> {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const { data, error } = await baseQuery(ctx, ADJ_SELECT)
    .eq("status", "aplicado")
    .is("notified_at", null)
    .gte("effective_date", addDays(ctx.today, -15))
    .lte("effective_date", addDays(ctx.today, 60))
    .eq("contract.status", "vigente")
    .order("effective_date", { ascending: true })
    .limit(40);
  if (error) return dbFailure("notifyAllApplied", error, "No se pudieron leer los ajustes.");
  let sent = 0;
  let failed = 0;
  const withoutEmail: { id: string; contractId: string; contractNumber: string; tenantName: string | null }[] = [];
  for (const row of (data ?? []) as unknown as AdjRow[]) {
    const v = toView(row, ctx.tz);
    const n = noticeInputOf(v);
    if (!n) continue;
    if (!v.tenantEmail || !EMAIL_RE.test(v.tenantEmail)) {
      withoutEmail.push({ id: v.id, contractId: v.contractId, contractNumber: formatContractNumber(v.contractNumber), tenantName: v.tenantName });
      continue;
    }
    const res = await sendNoticeMail(ctx, v, n);
    if (res.ok) {
      sent += 1;
      await markNotified(ctx, row, "email");
    } else {
      failed += 1;
    }
  }
  if (sent) revalidateRentals();
  return { ok: true, sent, failed, withoutEmail };
}
