"use server";

import { z } from "zod";
import { round2 } from "@/lib/finance/booking-economics";
import { formatMoney } from "@/lib/format";
import { toWhatsappDigits } from "@/lib/marketplace/staff-helpers";
import { formatReceiptNumber, monthLabelOf } from "@/lib/rentals/labels";
import { isYmd } from "@/lib/rentals/ymd";
import { PAYMENT_ROUTES } from "@/lib/rentals/payment-split-record";
import { rentalsContext, dbFailure, logRentalsError, type RentalsCtx } from "@/lib/rentals/server/access";
import { revalidateRentals } from "@/lib/rentals/server/revalidate";
import { applyAvailableCredit, computePaymentPreview, registerRentalPayment, voidRentalPayment } from "@/lib/rentals/server/payments";
import { resyncContract } from "@/lib/rentals/server/contracts";
import { depositItemGate } from "@/lib/rentals/server/deposit";
import { dropStaleDifferences, logRentalEvent, voidContractCharges, type StaleDifferencesResult } from "@/lib/rentals/server/contract-sync";
import { isEngineItem, rentDiscountOf } from "@/lib/rentals/charges";
import type { RentalChargeItemKind } from "@/lib/types/database";
import {
  loadCollectionsBoard,
  loadContractLedger,
  loadExpensasGrid,
  loadPaymentSetup,
  loadReceiptData,
  loadReminderData,
  portalUrlOf,
} from "@/lib/rentals/server/collections-queries";
import { sendGuestMail } from "@/lib/email/guest";
import { renderReceiptEmail, renderReminderEmail } from "@/lib/email/rentals-collections";
import { buildReceiptWhatsappText, buildReminderWhatsappText } from "@/components/rentals/collections/messages";
import { parseBoardMonth } from "@/components/rentals/collections/board-helpers";

/**
 * Cobranzas de alquileres tradicionales: tablero del mes, cobros con vista
 * previa del servidor, cuenta corriente, recibos, avisos y expensas.
 * Todas devuelven el error como valor (Next.js pisa el mensaje de un throw en
 * producción) y filtran por la organización activa.
 */

const uuid = z.string().uuid("Dato inválido");
const ymd = z.string().refine(isYmd, "La fecha no es válida");

const previewSchema = z.object({
  contractId: uuid,
  amount: z.coerce.number().min(0, "El importe no puede ser negativo").max(10_000_000_000, "El importe es demasiado grande"),
  paidAt: ymd,
  preferChargeIds: z.array(uuid).max(60).optional(),
  waiveLateFees: z.boolean().optional(),
});

const registerSchema = previewSchema.extend({
  amount: z.coerce.number().positive("Ingresá un importe mayor a cero").max(10_000_000_000, "El importe es demasiado grande"),
  method: z.enum(["efectivo", "transferencia", "mp", "cheque", "deposito", "otro"], { errorMap: () => ({ message: "Elegí el medio de pago" }) }),
  accountId: uuid.nullable(),
  agencyAccountId: uuid.nullable().optional(),
  /** Cobra el propietario: cómo le llegó la plata a cada uno (sin el dato, a cada uno su parte). */
  route: z.enum(PAYMENT_ROUTES, { errorMap: () => ({ message: "Elegí cómo pagó el inquilino" }) }).nullable().optional(),
  reference: z.string().max(120, "La referencia es muy larga").nullable().optional(),
  payerName: z.string().max(120, "El nombre es muy largo").nullable().optional(),
  notes: z.string().max(500, "La nota es muy larga").nullable().optional(),
  reportId: uuid.nullable().optional(),
});

function firstIssue(e: z.ZodError): { error: string; field?: string } {
  const issue = e.issues[0];
  return { error: issue?.message ?? "Revisá los datos", field: issue?.path?.[0]?.toString() };
}

function waUrlOf(phone: string | null | undefined): string | null {
  const digits = toWhatsappDigits(phone);
  return /^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function contractIdOfCharge(ctx: RentalsCtx, chargeId: string) {
  const { data } = await ctx.admin
    .from("rental_charges")
    .select("id, contract_id, kind, label, status, paid_amount, voided_at, currency")
    .eq("id", chargeId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  return data as { id: string; contract_id: string; kind: string; label: string; status: string; paid_amount: number; voided_at: string | null; currency: string } | null;
}

// ─── Cobro ──────────────────────────────────────────────────────────────────

/** Abre el diálogo de cobro: cuentas, datos del contrato y la primera vista previa (en un solo viaje). */
export async function openPaymentDialog(input: {
  contractId: string;
  amount?: number | null;
  paidAt?: string | null;
  preferChargeIds?: string[];
}) {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(input.contractId).success) return { ok: false as const, error: "No encontramos el contrato." };
  const setup = await loadPaymentSetup(ctx.admin, ctx.organization.id, input.contractId, ctx.today, ctx.organization.name);
  if (!setup) return { ok: false as const, error: "No encontramos el contrato." };
  if (setup.contract.status === "borrador") return { ok: false as const, error: "El contrato todavía es un borrador: activalo antes de cobrar." };
  const paidAt = input.paidAt && isYmd(input.paidAt) && input.paidAt <= ctx.today ? input.paidAt : ctx.today;
  const prefer = (input.preferChargeIds ?? []).filter((id) => uuid.safeParse(id).success);
  const wanted = input.amount != null && Number.isFinite(input.amount) && input.amount > 0 ? round2(input.amount) : null;
  let pre = await computePaymentPreview(ctx.admin, ctx.organization.id, { contractId: input.contractId, amount: wanted ?? 0, paidAt, preferChargeIds: prefer });
  if (!pre.ok) return pre;
  // Sin importe: lo que debe de los cargos elegidos (con sus intereses del día) o, si no eligió, todo.
  const preferred = pre.preview.charges.filter((c) => prefer.includes(c.id));
  let amount = wanted ?? (preferred.length ? round2(preferred.reduce((s, c) => s + c.outstanding, 0)) : pre.preview.totalDebt);
  if (wanted == null && amount > 0) {
    pre = await computePaymentPreview(ctx.admin, ctx.organization.id, { contractId: input.contractId, amount, paidAt, preferChargeIds: prefer });
    if (!pre.ok) return pre;
    amount = round2(amount);
  }
  return { ok: true as const, setup, preview: pre.preview, amount, paidAt };
}

/** Vista previa del cobro (punitorios al día del pago + imputación). Siempre del servidor. */
export async function previewPayment(input: z.input<typeof previewSchema>) {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  if (parsed.data.paidAt > ctx.today) return { ok: false as const, error: "La fecha del pago no puede ser futura.", field: "paidAt" };
  const pre = await computePaymentPreview(ctx.admin, ctx.organization.id, parsed.data);
  if (!pre.ok) return pre;
  return { ok: true as const, preview: pre.preview };
}

export async function registerPayment(input: z.input<typeof registerSchema>) {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  const res = await registerRentalPayment(ctx, { ...parsed.data, amount: round2(parsed.data.amount) });
  if (!res.ok) return res;
  revalidateRentals({ contractId: res.contractId, caja: true });
  return res;
}

export async function voidPayment(paymentId: string, reason: string) {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(paymentId).success) return { ok: false as const, error: "No encontramos el cobro." };
  const res = await voidRentalPayment(ctx, paymentId, reason ?? "");
  if (!res.ok) return res;
  // El saldo a favor de otros pagos puede cubrir lo que quedó abierto.
  await resyncContract(ctx, res.contractId);
  revalidateRentals({ contractId: res.contractId, caja: true });
  return { ok: true as const };
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

export async function getCollectionsBoard(month?: string | null) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const board = await loadCollectionsBoard(ctx.admin, ctx.organization.id, parseBoardMonth(month, ctx.today), ctx.today);
  return { ok: true as const, board };
}

export async function getContractLedger(contractId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(contractId).success) return { ok: false as const, error: "No encontramos el contrato." };
  const ledger = await loadContractLedger(ctx.admin, ctx.organization.id, contractId, ctx.today);
  if (!ledger) return { ok: false as const, error: "No encontramos el contrato." };
  return { ok: true as const, ledger };
}

// ─── Cargos: agregar, bonificar, anular, cargo extra ────────────────────────

const MANUAL_ITEM_KINDS = ["expensas", "servicio", "reparacion", "honorarios", "punitorio", "deposito", "sellado", "rescision", "otro"] as const;
const PAYEES = ["propietario", "inmobiliaria", "consorcio", "tercero"] as const;

const itemSchema = z.object({
  kind: z.enum(MANUAL_ITEM_KINDS, { errorMap: () => ({ message: "Elegí qué es" }) }),
  description: z.string().trim().min(2, "Escribí el concepto").max(200, "El concepto es muy largo"),
  amount: z.coerce.number().positive("Ingresá un importe mayor a cero").max(10_000_000_000, "El importe es demasiado grande"),
  payee: z.enum(PAYEES, { errorMap: () => ({ message: "Elegí para quién es la plata" }) }),
});

export async function addChargeItem(chargeId: string, input: z.input<typeof itemSchema>) {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  const charge = uuid.safeParse(chargeId).success ? await contractIdOfCharge(ctx, chargeId) : null;
  if (!charge) return { ok: false as const, error: "No encontramos el cargo." };
  if (charge.voided_at) return { ok: false as const, error: "El cargo está anulado." };
  const { kind, description, amount } = parsed.data;
  let payee = parsed.data.payee;
  // Depósito: sólo si se puede cobrar por la cuenta, y para quien lo guarda según
  // el contrato (no lo que venga del diálogo): si no, se le rendiría a quien no corresponde.
  if (kind === "deposito") {
    const gate = await depositItemGate(ctx.admin, ctx.organization.id, charge.contract_id);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    payee = gate.payee;
  }
  const { error } = await ctx.admin.from("rental_charge_items").insert({
    organization_id: ctx.organization.id,
    charge_id: charge.id,
    kind,
    payee,
    description,
    amount: round2(amount),
    meta: { added_by: ctx.session.userId, manual: true },
    sort_order: 30,
  });
  if (error) return dbFailure("addChargeItem", error, "No se pudo agregar el concepto.");
  await ctx.admin.rpc("rental_recompute_charges", { p_charge_ids: [charge.id] });
  await applyAvailableCredit(ctx.admin, ctx.organization.id, charge.contract_id);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: charge.contract_id,
    type: "cargo_concepto_agregado",
    summary: `Se agregó "${description}" por ${formatMoney(round2(amount), charge.currency)} a ${charge.label}.`,
    payload: { charge_id: charge.id, kind, amount: round2(amount) },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: charge.contract_id });
  return { ok: true as const };
}

const discountSchema = z.object({
  amount: z.coerce.number().positive("Ingresá cuánto se bonifica").max(10_000_000_000, "El importe es demasiado grande"),
  reason: z.string().trim().min(3, "Contá brevemente por qué (queda en el historial)").max(200, "El motivo es muy largo"),
});

/** Bonifica (baja) un concepto. Nunca por debajo de lo que ya se cobró de él. */
export async function discountChargeItem(itemId: string, input: z.input<typeof discountSchema>) {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = discountSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  if (!uuid.safeParse(itemId).success) return { ok: false as const, error: "No encontramos el concepto." };
  const { data } = await ctx.admin
    .from("rental_charge_items")
    .select("id, charge_id, description, amount, original_amount, discount_reason, paid_amount")
    .eq("id", itemId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const item = data as { id: string; charge_id: string; description: string; amount: number; original_amount: number | null; discount_reason: string | null; paid_amount: number } | null;
  if (!item) return { ok: false as const, error: "No encontramos el concepto." };
  const charge = await contractIdOfCharge(ctx, item.charge_id);
  if (!charge || charge.voided_at) return { ok: false as const, error: "El cargo está anulado." };
  const discount = round2(parsed.data.amount);
  const room = round2(Number(item.amount) - Number(item.paid_amount));
  if (room <= 0) return { ok: false as const, error: "Ese concepto ya está pagado: no queda saldo para bonificar." };
  if (discount > room + 0.004) {
    return {
      ok: false as const,
      error: `Como máximo podés bonificar ${formatMoney(room, charge.currency)}: el resto ya se cobró.`,
      field: "amount",
    };
  }
  const newAmount = round2(Number(item.amount) - discount);
  const reason = parsed.data.reason;
  const { error } = await ctx.admin
    .from("rental_charge_items")
    .update({
      amount: newAmount,
      original_amount: item.original_amount ?? Number(item.amount),
      discount_reason: (item.discount_reason ? `${item.discount_reason}; ${reason}` : reason).slice(0, 300),
    })
    .eq("id", item.id)
    .eq("organization_id", ctx.organization.id);
  if (error) return dbFailure("discountChargeItem", error, "No se pudo bonificar.");
  await ctx.admin.rpc("rental_recompute_charges", { p_charge_ids: [item.charge_id] });
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: charge.contract_id,
    type: "cargo_bonificado",
    summary: `Bonificación de ${formatMoney(discount, charge.currency)} en "${item.description}" (${charge.label}): ${reason}`,
    payload: { item_id: item.id, discount, new_amount: newAmount },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: charge.contract_id });
  return { ok: true as const, newAmount };
}

/**
 * Anula un cargo sin cobros. Un mensual anulado se vuelve a generar con los
 * valores actuales del contrato, y lo cargado a mano (expensas, conceptos,
 * punitorios y lo condonado) pasa al cargo nuevo del mismo mes.
 */
export async function voidCharge(chargeId: string, reason: string) {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const org = ctx.organization.id;
  const clean = (reason ?? "").trim();
  if (clean.length < 3) return { ok: false as const, error: "Contá brevemente por qué se anula (queda en el historial).", field: "reason" };
  const charge = uuid.safeParse(chargeId).success ? await contractIdOfCharge(ctx, chargeId) : null;
  if (!charge) return { ok: false as const, error: "No encontramos el cargo." };
  if (charge.voided_at) return { ok: false as const, error: "El cargo ya estaba anulado." };
  if (Number(charge.paid_amount) > 0) {
    return { ok: false as const, error: "Este cargo ya tiene cobros imputados. Anulá primero esos recibos o bonificá lo que falta." };
  }
  const { count } = await ctx.admin
    .from("rental_payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org)
    .eq("charge_id", charge.id);
  if ((count ?? 0) > 0) return { ok: false as const, error: "Este cargo ya tiene cobros imputados. Anulá primero esos recibos." };

  const isMonthly = charge.kind === "mensual";
  const [{ data: itemsData }, { data: periodRow }] = await Promise.all([
    ctx.admin
      .from("rental_charge_items")
      .select("id, kind, ref_type, ref_id, description, amount, original_amount")
      .eq("charge_id", charge.id)
      .eq("organization_id", org),
    ctx.admin.from("rental_charges").select("period_index").eq("id", charge.id).eq("organization_id", org).maybeSingle(),
  ]);
  type Item = { id: string; kind: string; ref_type: string | null; ref_id: string | null; description: string; amount: number; original_amount: number | null };
  const items = (itemsData ?? []) as Item[];
  const carriesDifference = items.some((i) => i.kind === "diferencia_ajuste" && i.ref_type === "rental_charge");

  if (isMonthly) {
    // La diferencia por ajuste de ESTE mes ya cobrada en otro cargo: el mes vuelve
    // con el precio ajustado y esa diferencia se pagaría dos veces.
    const { data: diffs } = await ctx.admin
      .from("rental_charge_items")
      .select("charge_id")
      .eq("organization_id", org)
      .eq("kind", "diferencia_ajuste")
      .eq("ref_type", "rental_charge")
      .eq("ref_id", charge.id)
      .gt("paid_amount", 0);
    const holders = [...new Set(((diffs ?? []) as { charge_id: string }[]).map((d) => d.charge_id))];
    if (holders.length) {
      const { data: live } = await ctx.admin.from("rental_charges").select("label").eq("organization_id", org).in("id", holders).is("voided_at", null);
      const labels = ((live ?? []) as { label: string }[]).map((l) => `«${l.label}»`);
      if (labels.length) {
        return {
          ok: false as const,
          error: `La diferencia por ajuste de este mes ya se cobró (en todo o en parte) en ${labels.join(" y ")}: si lo anulás, el mes vuelve con el precio ajustado y esa diferencia se pagaría dos veces. Si hay que corregirlo, bonificá en lugar de anular.`,
        };
      }
    }
  }

  // Anula y, en la misma transacción, devuelve a "pendiente" los gastos que se le
  // trasladaban al inquilino en este cargo (si no, no se cobrarían nunca).
  let voided = false;
  try {
    const res = await voidContractCharges(ctx.admin, org, charge.contract_id, [charge.id], clean.slice(0, 300));
    voided = res.voided.includes(charge.id);
  } catch (e) {
    return dbFailure("voidCharge", e as { message?: string }, "No se pudo anular el cargo.");
  }
  if (!voided) return { ok: false as const, error: "El cargo cambió mientras tanto (¿entró un cobro?). Recargá y probá de nuevo." };

  const notes: string[] = [];
  let regenerated = false;
  if (!isMonthly) {
    // Una diferencia por ajuste en un cargo aparte anulado queda perdonada: la
    // reconciliación la cuenta como saldada y no la vuelve a cobrar.
    if (carriesDifference) notes.push("La diferencia por ajuste queda perdonada: no se vuelve a cobrar.");
  } else {
    // La diferencia de este mes que se cobraba en otro cargo sobra: el mes vuelve
    // con el precio ajustado (o ya no se cobra). Antes de regenerar, como al editar el contrato.
    // El cargo ya está anulado: si esto falla no se puede lanzar (la persona vería un
    // error genérico y el mes no se volvería a generar). Se avisa qué revisar.
    let stale: StaleDifferencesResult = { dropped: 0, amount: 0, chargeLabels: [] };
    try {
      stale = await dropStaleDifferences(ctx.admin, org, charge.contract_id, [charge.id], `Se anuló ${charge.label}`);
    } catch (e) {
      logRentalsError("voidCharge:staleDifferences", e);
      notes.push("No se pudo revisar si la diferencia por ajuste de este mes se cobraba en otro cargo: revisá la cuenta para no cobrarla dos veces.");
    }
    await resyncContract(ctx, charge.contract_id);
    const periodIndex = (periodRow as { period_index: number | null } | null)?.period_index;
    const { data: again } =
      periodIndex == null
        ? { data: null }
        : await ctx.admin
            .from("rental_charges")
            .select("id, items:rental_charge_items(meta)")
            .eq("organization_id", org)
            .eq("contract_id", charge.contract_id)
            .eq("kind", "mensual")
            .eq("period_index", periodIndex)
            .is("voided_at", null)
            .maybeSingle();
    const fresh = again as { id: string; items: { meta: Record<string, unknown> | null }[] } | null;
    regenerated = Boolean(fresh);
    const carriedFrom = new Set((fresh?.items ?? []).map((i) => String(i.meta?.carried_from ?? "")).filter(Boolean));
    const manual = items.filter((i) => !isEngineItem({ kind: i.kind as RentalChargeItemKind, ref_type: i.ref_type }) && Number(i.amount) > 0);
    const carried = manual.filter((i) => carriedFrom.has(i.id)).map((i) => i.description);
    const missing = manual.filter((i) => !carriedFrom.has(i.id)).map((i) => i.description);
    const rentDiscount = rentDiscountOf(items.map((i) => ({ kind: i.kind as RentalChargeItemKind, amount: i.amount, original_amount: i.original_amount })));
    if (stale.dropped) {
      notes.push(
        `Se sacó la diferencia por ajuste de este mes que se cobraba en ${quoteList(stale.chargeLabels)} (${formatMoney(stale.amount, charge.currency)}): ${regenerated ? "el mes nuevo ya sale con el precio ajustado" : "el mes ya no se cobra"}.`,
      );
    }
    if (carriesDifference) notes.push("Si este cargo llevaba la diferencia por ajuste de otro mes, se vuelve a cobrar aparte. Para perdonarla, bonificala en lugar de anular.");
    if (carried.length) {
      notes.push(
        carried.length === 1
          ? `Pasó al cargo nuevo: ${quoteList(carried)}. Si no corresponde, bonificalo.`
          : `Pasaron al cargo nuevo: ${quoteList(carried)}. Si alguno no corresponde, bonificalo.`,
      );
    }
    if (missing.length) {
      notes.push(
        regenerated
          ? `No se ${missing.length === 1 ? "pudo pasar" : "pudieron pasar"} ${quoteList(missing)} al cargo nuevo: ${missing.length === 1 ? "cargalo de nuevo si corresponde" : "cargalos de nuevo si corresponden"}.`
          : `Este mes no se vuelve a generar, así que ${quoteList(missing)} ${missing.length === 1 ? "quedó anulado" : "quedaron anulados"} con él.`,
      );
    }
    if (rentDiscount > 0 && regenerated) {
      notes.push(`La bonificación de ${formatMoney(rentDiscount, charge.currency)} del alquiler no pasó al cargo nuevo: si sigue correspondiendo, volvé a bonificarlo.`);
    }
  }
  const notice = notes.length ? notes.join(" ") : null;
  await logRentalEvent(ctx.admin, {
    organizationId: org,
    contractId: charge.contract_id,
    type: "cargo_anulado",
    summary: `Se anuló el cargo ${charge.label}: ${clean}${regenerated ? " (se volvió a generar con los valores actuales)" : ""}.${notice ? ` ${notice}` : ""}`,
    payload: { charge_id: charge.id, regenerated, forgave_difference: carriesDifference && !isMonthly },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId: charge.contract_id });
  return { ok: true as const, regenerated, notice };
}

/** «A», «A» y «B», «A», «B» y «C». */
function quoteList(labels: string[]): string {
  const quoted = [...new Set(labels)].map((l) => `«${l}»`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1]}`;
}

const extraChargeSchema = z.object({
  label: z.string().trim().min(3, "Poné un nombre al cargo").max(200, "El nombre es muy largo"),
  dueDate: ymd,
  kind: z.enum(["extra", "salida"]).default("extra"),
  items: z.array(itemSchema).min(1, "Agregá al menos un concepto").max(20, "Son demasiados conceptos"),
});

export async function createExtraCharge(contractId: string, input: z.input<typeof extraChargeSchema>) {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = extraChargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  if (!uuid.safeParse(contractId).success) return { ok: false as const, error: "No encontramos el contrato." };
  const { data: c } = await ctx.admin
    .from("rental_contracts")
    .select("id, status, currency, property_id")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!c) return { ok: false as const, error: "No encontramos el contrato." };
  if (c.status === "borrador") return { ok: false as const, error: "El contrato todavía es un borrador: activalo antes de cargarle cobros." };
  const { label, dueDate, kind, items } = parsed.data;
  // Depósito: igual que en addChargeItem, para quien lo guarda según el contrato.
  let depositPayee: (typeof PAYEES)[number] | null = null;
  if (items.some((i) => i.kind === "deposito")) {
    const gate = await depositItemGate(ctx.admin, ctx.organization.id, contractId);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    depositPayee = gate.payee;
  }
  const { data, error } = await ctx.admin.rpc("rental_create_charge", {
    p_organization_id: ctx.organization.id,
    p_contract_id: contractId,
    p_charge: { kind, label, due_date: dueDate, currency: c.currency, created_by: ctx.session.userId },
    p_items: items.map((i, idx) => ({
      kind: i.kind,
      payee: i.kind === "deposito" && depositPayee ? depositPayee : i.payee,
      description: i.description,
      amount: round2(i.amount),
      meta: { manual: true },
      sort_order: idx,
    })),
  });
  if (error) return dbFailure("createExtraCharge", error, "No se pudo crear el cargo.");
  await applyAvailableCredit(ctx.admin, ctx.organization.id, contractId);
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    propertyId: c.property_id as string,
    type: "cargo_extra_creado",
    summary: `Nuevo cargo "${label}" por ${formatMoney(total, c.currency as string)} (vence el ${dueDate.split("-").reverse().join("/")}).`,
    payload: { charge_id: (data as { charge_id?: string } | null)?.charge_id ?? null, total },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId });
  return { ok: true as const, chargeId: (data as { charge_id?: string } | null)?.charge_id ?? null };
}

// ─── Generar cargos ya ──────────────────────────────────────────────────────

/** Sincroniza todos los contratos vigentes (lo mismo que hace el cron cada día). */
export async function generateChargesNow() {
  const r = await rentalsContext("create");
  if (!r.ok) return r;
  const { ctx } = r;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const { data, error } = await ctx.admin
    .from("rental_contracts")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .eq("status", "vigente");
  if (error) return dbFailure("generateChargesNow", error, "No se pudieron leer los contratos.");
  const ids = ((data ?? []) as { id: string }[]).map((c) => c.id);
  const BUDGET_MS = 40_000;
  const CONCURRENCY = 4;
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < ids.length && Date.now() - t0 < BUDGET_MS) {
      const id = ids[next++];
      await resyncContract(ctx, id);
      done += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  const { count } = await ctx.admin
    .from("rental_charges")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organization.id)
    .gte("created_at", startedAt);
  revalidateRentals({});
  return { ok: true as const, contracts: ids.length, synced: done, created: count ?? 0, partial: done < ids.length };
}

// ─── Expensas del mes ───────────────────────────────────────────────────────

export async function getExpensasGrid(month?: string | null) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const m = parseBoardMonth(month, ctx.today);
  const rows = await loadExpensasGrid(ctx.admin, ctx.organization.id, m, ctx.today);
  return { ok: true as const, month: m, rows };
}

const expensasSchema = z
  .array(
    z.object({
      contractId: uuid,
      amount: z.coerce.number().min(0, "El importe no puede ser negativo").max(10_000_000_000).nullable(),
    }),
  )
  .max(500);

/**
 * Carga o corrige el ítem "Expensas" del cargo mensual de cada contrato cuyas
 * expensas cobra la inmobiliaria. Vacío o 0 = sacar las expensas (si no se
 * cobraron). Nunca por debajo de lo que ya se cobró de ellas.
 */
export async function saveExpensasAmounts(month: string, rows: z.input<typeof expensasSchema>) {
  const r = await rentalsContext("update");
  if (!r.ok) return r;
  const { ctx } = r;
  const parsed = expensasSchema.safeParse(rows);
  if (!parsed.success) return { ok: false as const, ...firstIssue(parsed.error) };
  const m = parseBoardMonth(month, ctx.today);
  const grid = await loadExpensasGrid(ctx.admin, ctx.organization.id, m, ctx.today);
  const byContract = new Map(grid.map((g) => [g.contractId, g]));
  const errors: { contractId: string; error: string }[] = [];
  const touchedCharges = new Set<string>();
  const touchedContracts = new Set<string>();
  let saved = 0;
  for (const row of parsed.data) {
    const g = byContract.get(row.contractId);
    if (!g) continue;
    const amount = row.amount == null ? 0 : round2(row.amount);
    const current = g.amount ?? 0;
    if (Math.abs(amount - current) < 0.005 && !(amount === 0 && g.itemId && current === 0)) continue;
    if (!g.chargeId) {
      errors.push({ contractId: g.contractId, error: g.blockedReason ?? "No hay cargo del mes." });
      continue;
    }
    if (amount < g.paidOnItem - 0.004) {
      errors.push({ contractId: g.contractId, error: `Ya se cobraron ${formatMoney(g.paidOnItem, g.currency)} de estas expensas: no pueden quedar por debajo.` });
      continue;
    }
    let error: { message?: string } | null = null;
    if (g.itemId && amount === 0) {
      ({ error } = await ctx.admin.from("rental_charge_items").delete().eq("id", g.itemId).eq("organization_id", ctx.organization.id).eq("paid_amount", 0));
    } else if (g.itemId) {
      ({ error } = await ctx.admin.from("rental_charge_items").update({ amount }).eq("id", g.itemId).eq("organization_id", ctx.organization.id));
    } else if (amount > 0) {
      ({ error } = await ctx.admin.from("rental_charge_items").insert({
        organization_id: ctx.organization.id,
        charge_id: g.chargeId,
        kind: "expensas",
        payee: "consorcio",
        description: `Expensas ${monthLabelOf(m)}`,
        amount,
        meta: { month: m },
        sort_order: 10,
      }));
    } else {
      continue;
    }
    if (error) {
      logRentalsError("saveExpensasAmounts", error);
      errors.push({ contractId: g.contractId, error: "No se pudo guardar." });
      continue;
    }
    touchedCharges.add(g.chargeId);
    touchedContracts.add(g.contractId);
    saved += 1;
  }
  if (touchedCharges.size) await ctx.admin.rpc("rental_recompute_charges", { p_charge_ids: [...touchedCharges] });
  for (const contractId of touchedContracts) {
    await applyAvailableCredit(ctx.admin, ctx.organization.id, contractId);
    await logRentalEvent(ctx.admin, {
      organizationId: ctx.organization.id,
      contractId,
      type: "expensas_cargadas",
      summary: `Se cargaron las expensas de ${monthLabelOf(m)}.`,
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }
  if (saved) revalidateRentals({});
  for (const id of touchedContracts) revalidateRentals({ contractId: id });
  return { ok: true as const, saved, errors };
}

// ─── Recibo ─────────────────────────────────────────────────────────────────

/** Datos para armar el PDF del recibo en el navegador. */
export async function getReceiptData(paymentId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(paymentId).success) return { ok: false as const, error: "No encontramos el recibo." };
  const data = await loadReceiptData(ctx.admin, ctx.organization.id, paymentId, ctx.today);
  if (!data) return { ok: false as const, error: "No encontramos el recibo." };
  return { ok: true as const, data };
}

async function contractPortalUrl(ctx: RentalsCtx, contractId: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("id, portal_enabled, portal_token_hash, portal_token_version")
    .eq("id", contractId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  return data ? portalUrlOf(data as { id: string; portal_enabled: boolean; portal_token_hash: string | null; portal_token_version: number }) : null;
}

/** Manda el recibo por mail al inquilino (PDF adjunto). `to` permite otro destinatario. */
export async function sendReceiptEmail(paymentId: string, to?: string | null) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(paymentId).success) return { ok: false as const, error: "No encontramos el recibo." };
  const data = await loadReceiptData(ctx.admin, ctx.organization.id, paymentId, ctx.today);
  if (!data) return { ok: false as const, error: "No encontramos el recibo." };
  const dest = (to ?? data.tenant.email ?? "").trim();
  if (!dest) return { ok: false as const, error: "El inquilino no tiene mail cargado. Cargalo en su ficha o mandale el recibo por WhatsApp.", field: "to" };
  if (!EMAIL_RE.test(dest)) return { ok: false as const, error: "Revisá el mail: no parece válido.", field: "to" };
  try {
    const { renderRentalReceiptPdfBuffer } = await import("@/lib/pdf/rental-receipt-pdf");
    const [pdf, portalUrl] = await Promise.all([renderRentalReceiptPdfBuffer(data), contractPortalUrl(ctx, data.contract.id)]);
    const mail = renderReceiptEmail(data, { portalUrl });
    const sent = await sendGuestMail({
      organizationId: ctx.organization.id,
      to: dest,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: ctx.organization.contact_email ?? undefined,
      attachments: [{ filename: pdf.filename, content: pdf.buffer }],
    });
    if (!sent.ok) {
      logRentalsError("sendReceiptEmail", sent.error);
      return { ok: false as const, error: "No se pudo mandar el mail. Probá de nuevo en un rato o mandalo por WhatsApp." };
    }
  } catch (e) {
    logRentalsError("sendReceiptEmail:render", e);
    return { ok: false as const, error: "No se pudo armar el recibo para mandarlo." };
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: data.contract.id,
    type: "recibo_enviado",
    summary: `Recibo ${formatReceiptNumber(data.receipt.number)} enviado por mail a ${dest}.`,
    payload: { payment_id: paymentId, to: dest },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true as const, to: dest };
}

/** Texto del recibo para pegar en WhatsApp + link al chat del inquilino. */
export async function getReceiptWhatsapp(paymentId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(paymentId).success) return { ok: false as const, error: "No encontramos el recibo." };
  const data = await loadReceiptData(ctx.admin, ctx.organization.id, paymentId, ctx.today);
  if (!data) return { ok: false as const, error: "No encontramos el recibo." };
  const portalUrl = await contractPortalUrl(ctx, data.contract.id);
  const text = buildReceiptWhatsappText({
    tenantName: data.tenant.name,
    isCompany: data.tenant.isCompany,
    orgName: ctx.organization.name,
    address: data.contract.address,
    amount: data.receipt.amount,
    currency: data.receipt.currency,
    receiptNumber: formatReceiptNumber(data.receipt.number),
    pendingTotal: data.pending.total,
    creditLeft: data.creditLeft,
    portalUrl,
    voided: data.receipt.voided,
  });
  return { ok: true as const, text, waUrl: waUrlOf(data.tenant.phone), phone: data.tenant.phone };
}

// ─── Aviso de pago ──────────────────────────────────────────────────────────

/** Aviso de pago por mail: lo que debe, vencimientos y cómo pagar. */
export async function sendPaymentReminder(contractId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(contractId).success) return { ok: false as const, error: "No encontramos el contrato." };
  const data = await loadReminderData(ctx.admin, ctx.organization.id, contractId, ctx.today);
  if (!data) return { ok: false as const, error: "No encontramos el contrato." };
  const email = data.tenant?.email?.trim();
  if (!email) return { ok: false as const, error: "El inquilino no tiene mail cargado. Cargalo en su ficha o mandale el aviso por WhatsApp." };
  if (!EMAIL_RE.test(email)) return { ok: false as const, error: "El mail del inquilino no parece válido. Revisalo en su ficha." };
  if (!data.lines.some((l) => l.outstanding > 0.004)) return { ok: false as const, error: "No tiene nada pendiente: no hace falta avisarle." };
  const mail = renderReminderEmail(data);
  const sent = await sendGuestMail({
    organizationId: ctx.organization.id,
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: ctx.organization.contact_email ?? undefined,
  });
  if (!sent.ok) {
    logRentalsError("sendPaymentReminder", sent.error);
    return { ok: false as const, error: "No se pudo mandar el mail. Probá de nuevo en un rato o mandá el aviso por WhatsApp." };
  }
  const nowIso = new Date().toISOString();
  const { error: nErr } = await ctx.admin
    .from("rental_charges")
    .update({ notified_at: nowIso })
    .eq("organization_id", ctx.organization.id)
    .eq("contract_id", contractId)
    .is("voided_at", null)
    .in("status", ["pendiente", "parcial"]);
  if (nErr) logRentalsError("sendPaymentReminder:notified_at", nErr);
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    type: "aviso_pago_enviado",
    summary: `Aviso de pago enviado por mail a ${email}.`,
    payload: { to: email },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  revalidateRentals({ contractId });
  return { ok: true as const, to: email };
}

/** Texto del aviso de pago para pegar en WhatsApp + link al chat. */
export async function buildReminderWhatsapp(contractId: string) {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  if (!uuid.safeParse(contractId).success) return { ok: false as const, error: "No encontramos el contrato." };
  const data = await loadReminderData(ctx.admin, ctx.organization.id, contractId, ctx.today);
  if (!data) return { ok: false as const, error: "No encontramos el contrato." };
  const text = buildReminderWhatsappText({
    tenantName: data.tenant?.name ?? "",
    isCompany: data.tenant?.isCompany,
    orgName: data.org.name,
    address: data.address,
    currency: data.currency,
    today: data.today,
    lines: data.lines,
    hasLateFees: data.hasLateFees,
    paymentInstructions: data.paymentInstructions,
    portalUrl: data.portalUrl,
  });
  return { ok: true as const, text, waUrl: waUrlOf(data.tenant?.phone), phone: data.tenant?.phone ?? null, hasDebt: data.lines.length > 0 };
}
