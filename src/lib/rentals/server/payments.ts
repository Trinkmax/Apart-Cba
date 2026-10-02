import "server-only";
import { round2 } from "@/lib/finance/booking-economics";
import { zonedTimeToUtc } from "@/lib/dates";
import type {
  RentalCharge,
  RentalChargeItem,
  RentalChargeItemKind,
  RentalContract,
  RentalPayee,
  RentalPaymentMethod,
} from "@/lib/types/database";
import { allocatePayment, type OpenItem } from "@/lib/rentals/allocation";
import { computeLateFee, lateFeeAlreadyBilled, type BasePayment } from "@/lib/rentals/late-fees";
import { LATE_FEE_TYPE_LABEL } from "@/lib/rentals/labels";
import { applyAvailableCredit, logRentalEvent } from "./contract-sync";
import { dbFailure, type ActionResult, type AdminClient, type RentalsCtx } from "./access";

/**
 * Cobros del inquilino.
 *
 * La vista previa se arma SIEMPRE en el servidor con datos frescos: punitorios
 * al día real del pago (sobre el saldo de alquiler de cada cargo vencido, por
 * tramos si hubo pagos parciales) e imputación según el CCyC (art. 900 si el
 * inquilino eligió qué paga; si no, lo más viejo primero y dentro de cada
 * cargo intereses antes que capital). El registro vuelve a calcular todo y lo
 * manda a la función atómica `rental_register_payment` (068b).
 */

const LATE_FEE_BASE_KINDS: ReadonlySet<RentalChargeItemKind> = new Set(["alquiler", "diferencia_ajuste"]);

export interface PreviewItem {
  /** id real, o "nuevo:N" para un punitorio que nace con este pago. */
  itemId: string;
  kind: RentalChargeItemKind;
  payee: RentalPayee;
  description: string;
  outstanding: number;
}

export interface PreviewCharge {
  id: string;
  label: string;
  dueDate: string;
  subtotal: number;
  paid: number;
  outstanding: number;
  items: PreviewItem[];
}

export interface LateFeeLine {
  chargeId: string;
  chargeLabel: string;
  dueDate: string;
  daysLate: number;
  base: number;
  amount: number;
  alreadyBilled: number;
  description: string;
}

export interface PreviewAllocation {
  chargeId: string;
  itemId: string | null;
  newItemIndex: number | null;
  description: string;
  amount: number;
}

export interface PaymentPreview {
  contractId: string;
  currency: string;
  collector: RentalContract["collector"];
  charges: PreviewCharge[];
  /** Punitorios que nacen con este cobro y entran en la deuda. */
  lateFees: LateFeeLine[];
  /**
   * Punitorios que correspondían al día del pago y se condonan en este cobro.
   * No se cobran, pero quedan anotados en $ 0 en su cargo: si no, el próximo
   * pago del mismo cargo los volvía a calcular (el punitorio es acumulado).
   */
  waivedLateFees: LateFeeLine[];
  /** Lo que debe hoy, con los punitorios nuevos incluidos. */
  totalDebt: number;
  allocations: PreviewAllocation[];
  /** Lo que sobra del pago: queda como saldo a favor. */
  remainder: number;
  coversAll: boolean;
}

export interface PaymentPreviewInput {
  contractId: string;
  amount: number;
  paidAt: string;
  preferChargeIds?: string[];
  waiveLateFees?: boolean;
}

type ChargeWithItems = Pick<RentalCharge, "id" | "label" | "due_date" | "subtotal" | "paid_amount" | "status"> & {
  items: Pick<RentalChargeItem, "id" | "kind" | "payee" | "description" | "amount" | "original_amount" | "paid_amount" | "sort_order" | "meta">[];
};

export async function computePaymentPreview(
  admin: AdminClient,
  organizationId: string,
  input: PaymentPreviewInput,
): Promise<{ ok: true; preview: PaymentPreview; contract: RentalContract } | { ok: false; error: string }> {
  const { data: contractData } = await admin
    .from("rental_contracts")
    .select("*")
    .eq("id", input.contractId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const contract = contractData as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };

  const { data: chargesData, error } = await admin
    .from("rental_charges")
    .select("id, label, due_date, subtotal, paid_amount, status, items:rental_charge_items(id, kind, payee, description, amount, original_amount, paid_amount, sort_order, meta)")
    .eq("contract_id", contract.id)
    .is("voided_at", null)
    .in("status", ["pendiente", "parcial"])
    .order("due_date", { ascending: true });
  if (error) return dbFailure("computePaymentPreview:charges", error, "No se pudo leer la cuenta del inquilino.");
  const charges = (chargesData ?? []) as ChargeWithItems[];

  // Pagos ya imputados a la base de cada cargo vencido (para el punitorio por tramos).
  const overdue = charges.filter((c) => c.due_date < input.paidAt);
  const basePaymentsByCharge = new Map<string, BasePayment[]>();
  if (overdue.length) {
    const { data: allocs } = await admin
      .from("rental_payment_allocations")
      .select("charge_id, charge_item_id, amount, payment:rental_payments!inner(paid_at, voided_at)")
      .in("charge_id", overdue.map((c) => c.id));
    type A = { charge_id: string; charge_item_id: string; amount: number; payment: { paid_at: string; voided_at: string | null } | null };
    const baseItemIds = new Set(overdue.flatMap((c) => c.items.filter((i) => LATE_FEE_BASE_KINDS.has(i.kind)).map((i) => i.id)));
    for (const a of (allocs ?? []) as unknown as A[]) {
      if (!a.payment || a.payment.voided_at || !baseItemIds.has(a.charge_item_id)) continue;
      const list = basePaymentsByCharge.get(a.charge_id) ?? [];
      list.push({ date: a.payment.paid_at, amount: Number(a.amount) });
      basePaymentsByCharge.set(a.charge_id, list);
    }
  }

  // Se calculan aunque se condonen: lo condonado se anota (en $ 0) con el monto
  // exacto que correspondía, para que el próximo cobro no lo vuelva a sumar.
  const feeLines: LateFeeLine[] = [];
  if (contract.late_fee_type !== "ninguno" && Number(contract.late_fee_value) > 0) {
    for (const c of overdue) {
      const base = round2(c.items.filter((i) => LATE_FEE_BASE_KINDS.has(i.kind)).reduce((s, i) => s + Number(i.amount), 0));
      if (base <= 0) continue;
      const fee = computeLateFee({
        dueDate: c.due_date,
        asOf: input.paidAt,
        baseAmount: base,
        payments: basePaymentsByCharge.get(c.id) ?? [],
        rules: { type: contract.late_fee_type, value: Number(contract.late_fee_value), graceDays: contract.grace_days },
      });
      // Lo ya facturado se mide ANTES de cualquier bonificación y suma lo condonado al
      // cobrar (marcas en $ 0): nada de lo perdonado lo tiene que volver a generar.
      const alreadyBilled = lateFeeAlreadyBilled(
        c.items
          .filter((i) => i.kind === "punitorio")
          .map((i) => ({ amount: Number(i.amount), originalAmount: i.original_amount, meta: i.meta })),
      );
      const amount = round2(fee.amount - alreadyBilled);
      if (amount <= 0) continue;
      const rate = `${Number(contract.late_fee_value).toLocaleString("es-AR")} ${LATE_FEE_TYPE_LABEL[contract.late_fee_type]}`;
      feeLines.push({
        chargeId: c.id,
        chargeLabel: c.label,
        dueDate: c.due_date,
        daysLate: fee.daysLate,
        base,
        amount,
        alreadyBilled,
        description: `${input.waiveLateFees ? "Intereses por mora condonados" : "Intereses por mora"} · ${c.label} · ${fee.daysLate} días al ${rate}`.slice(0, 200),
      });
    }
  }
  const lateFees = input.waiveLateFees ? [] : feeLines;
  const waivedLateFees = input.waiveLateFees ? feeLines : [];

  const previewCharges: PreviewCharge[] = charges.map((c) => {
    const items: PreviewItem[] = c.items
      .map((i) => ({
        itemId: i.id,
        kind: i.kind,
        payee: i.payee,
        description: i.description,
        outstanding: round2(Number(i.amount) - Number(i.paid_amount)),
      }))
      .filter((i) => i.outstanding > 0);
    lateFees.forEach((f, idx) => {
      if (f.chargeId === c.id) {
        items.unshift({ itemId: `nuevo:${idx}`, kind: "punitorio", payee: contract.late_fee_payee, description: f.description, outstanding: f.amount });
      }
    });
    const outstanding = round2(items.reduce((s, i) => s + i.outstanding, 0));
    return { id: c.id, label: c.label, dueDate: c.due_date, subtotal: Number(c.subtotal), paid: Number(c.paid_amount), outstanding, items };
  });

  const sortOrderOf = new Map(charges.flatMap((c) => c.items.map((i) => [i.id, i.sort_order] as const)));
  const open: OpenItem[] = previewCharges.flatMap((c) =>
    c.items.map((i) => ({
      itemId: i.itemId,
      chargeId: c.id,
      dueDate: c.dueDate,
      kind: i.kind,
      outstanding: i.outstanding,
      sortOrder: sortOrderOf.get(i.itemId) ?? -1,
    })),
  );
  const amount = round2(input.amount);
  const { allocations, remainder } = allocatePayment(amount, open, input.preferChargeIds ?? []);
  const descOf = new Map(previewCharges.flatMap((c) => c.items.map((i) => [i.itemId, i.description] as const)));
  const totalDebt = round2(previewCharges.reduce((s, c) => s + c.outstanding, 0));

  return {
    ok: true,
    contract,
    preview: {
      contractId: contract.id,
      currency: contract.currency,
      collector: contract.collector,
      charges: previewCharges,
      lateFees,
      waivedLateFees,
      totalDebt,
      allocations: allocations.map((a) => ({
        chargeId: a.chargeId,
        itemId: a.itemId.startsWith("nuevo:") ? null : a.itemId,
        newItemIndex: a.itemId.startsWith("nuevo:") ? Number(a.itemId.slice(6)) : null,
        description: descOf.get(a.itemId) ?? "",
        amount: a.amount,
      })),
      remainder,
      coversAll: amount >= totalDebt - 0.005,
    },
  };
}

// ─── Registrar / anular ─────────────────────────────────────────────────────

export interface RegisterPaymentInput extends PaymentPreviewInput {
  method: RentalPaymentMethod;
  /** Cuenta de Caja donde entró la plata. Obligatoria si cobra la inmobiliaria. */
  accountId: string | null;
  reference?: string | null;
  payerName?: string | null;
  notes?: string | null;
  /** Aviso de pago del portal que se está registrando. */
  reportId?: string | null;
}

/** Titular "principal" de la propiedad del contrato (para el owner_id del ingreso en Caja). */
async function primaryOwnerOf(admin: AdminClient, propertyId: string): Promise<string | null> {
  const { data } = await admin
    .from("rental_property_owners")
    .select("owner_id, ownership_pct, is_primary")
    .eq("property_id", propertyId);
  const rows = (data ?? []) as { owner_id: string; ownership_pct: number; is_primary: boolean }[];
  if (!rows.length) return null;
  const primary = rows.find((r) => r.is_primary);
  if (primary) return primary.owner_id;
  return [...rows].sort((a, b) => Number(b.ownership_pct) - Number(a.ownership_pct))[0].owner_id;
}

export async function registerRentalPayment(
  ctx: RentalsCtx,
  input: RegisterPaymentInput,
): Promise<ActionResult<{ paymentId: string; receiptNumber: number; remainder: number; contractId: string }>> {
  if (!(input.amount > 0)) return { ok: false, error: "Ingresá un importe mayor a cero.", field: "amount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) return { ok: false, error: "La fecha del pago no es válida.", field: "paidAt" };
  if (input.paidAt > ctx.today) return { ok: false, error: "La fecha del pago no puede ser futura.", field: "paidAt" };

  const pre = await computePaymentPreview(ctx.admin, ctx.organization.id, input);
  if (!pre.ok) return pre;
  const { preview, contract } = pre;
  if (contract.status === "borrador") return { ok: false, error: "El contrato todavía es un borrador: activalo antes de cobrar." };
  if (contract.collector === "inmobiliaria" && !input.accountId) {
    return { ok: false, error: "Elegí la cuenta de Caja donde entró la plata.", field: "accountId" };
  }
  const ownerId = await primaryOwnerOf(ctx.admin, contract.property_id);

  const { data, error } = await ctx.admin.rpc("rental_register_payment", {
    p_organization_id: ctx.organization.id,
    p_contract_id: contract.id,
    p_payment: {
      paid_at: input.paidAt,
      amount: round2(input.amount),
      currency: contract.currency,
      method: input.method,
      account_id: contract.collector === "inmobiliaria" ? input.accountId : null,
      reference: input.reference?.trim() || null,
      payer_name: input.payerName?.trim() || null,
      notes: input.notes?.trim() || null,
      report_id: input.reportId ?? null,
      created_by: ctx.session.userId,
      owner_id: ownerId,
      occurred_at: zonedTimeToUtc(input.paidAt, "12:00", ctx.tz).toISOString(),
    },
    // Primero los punitorios que se cobran (las imputaciones los apuntan por
    // posición: `new_item_index`) y después las marcas en $ 0 de lo condonado,
    // que ninguna imputación toca. Anular el cobro borra las dos cosas (068b).
    p_new_items: [
      ...preview.lateFees.map((f) => ({
        charge_id: f.chargeId,
        kind: "punitorio",
        payee: contract.late_fee_payee,
        description: f.description,
        amount: f.amount,
        meta: { days_late: f.daysLate, base: f.base, as_of: input.paidAt },
      })),
      ...preview.waivedLateFees.map((f) => ({
        charge_id: f.chargeId,
        kind: "punitorio",
        payee: contract.late_fee_payee,
        description: f.description,
        amount: 0,
        meta: { waived: true, waived_amount: f.amount, days_late: f.daysLate, base: f.base, as_of: input.paidAt },
      })),
    ],
    p_allocations: preview.allocations.map((a) => ({
      charge_id: a.chargeId,
      item_id: a.itemId,
      new_item_index: a.newItemIndex,
      amount: a.amount,
    })),
  });
  if (error) return dbFailure("registerRentalPayment", error, "No se pudo registrar el cobro. Probá de nuevo.");
  const res = data as { payment_id: string; receipt_number: number; unallocated: number };
  const waivedTotal = round2(preview.waivedLateFees.reduce((s, f) => s + f.amount, 0));

  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: contract.id,
    type: "cobro_registrado",
    summary: `Cobro de ${round2(input.amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${contract.currency} · recibo ${String(res.receipt_number).padStart(6, "0")}${
      preview.lateFees.length ? ` (incluye punitorios por ${round2(preview.lateFees.reduce((s, f) => s + f.amount, 0)).toLocaleString("es-AR")})` : ""
    }${waivedTotal > 0 ? ` · se condonaron punitorios por ${waivedTotal.toLocaleString("es-AR")}` : ""}`,
    payload: { payment_id: res.payment_id, receipt_number: res.receipt_number, waived: waivedTotal > 0, waived_amount: waivedTotal },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, paymentId: res.payment_id, receiptNumber: res.receipt_number, remainder: Number(res.unallocated), contractId: contract.id };
}

export async function voidRentalPayment(
  ctx: RentalsCtx,
  paymentId: string,
  reason: string,
): Promise<ActionResult<{ contractId: string }>> {
  const clean = reason.trim();
  if (clean.length < 3) return { ok: false, error: "Contá brevemente por qué se anula (queda en el historial).", field: "reason" };
  const { data: pay } = await ctx.admin
    .from("rental_payments")
    .select("id, contract_id, receipt_number, amount, currency")
    .eq("id", paymentId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!pay) return { ok: false, error: "No encontramos el cobro." };
  const { error } = await ctx.admin.rpc("rental_void_payment", {
    p_organization_id: ctx.organization.id,
    p_payment_id: paymentId,
    p_reason: clean,
    p_actor: ctx.session.userId,
  });
  if (error) return dbFailure("voidRentalPayment", error, "No se pudo anular el cobro.");
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: pay.contract_id as string,
    type: "cobro_anulado",
    summary: `Se anuló el recibo ${String(pay.receipt_number ?? "").padStart(6, "0")}: ${clean}`.slice(0, 400),
    payload: { payment_id: paymentId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, contractId: pay.contract_id as string };
}

/** Después de anular o cargar cargos nuevos, el saldo a favor se vuelve a imputar. */
export { applyAvailableCredit };
