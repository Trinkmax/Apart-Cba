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
import { formatMoney } from "@/lib/format";
import { allocatePayment, type OpenItem } from "@/lib/rentals/allocation";
import { computeLateFee, lateFeeAlreadyBilled, type BasePayment } from "@/lib/rentals/late-fees";
import { LATE_FEE_TYPE_LABEL } from "@/lib/rentals/labels";
import { agencyPartLabel, primaryOwnerIndex, splitDirectPayment, type PaymentSplit, type SplitLine } from "@/lib/rentals/payment-split";
import {
  agencyMovementLabel,
  isPaymentRoute,
  passThroughMovementLabel,
  paymentRouteText,
  splitLinesFromAllocations,
  splitSnapshot,
  type PaymentRoute,
  type SplitItemRef,
  type SplitOwnerBank,
} from "@/lib/rentals/payment-split-record";
import { applyAvailableCredit, logRentalEvent } from "./contract-sync";
import { dbFailure, logRentalsError, type ActionResult, type AdminClient, type RentalsCtx } from "./access";

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
  /**
   * Reparto del cobro cuando el inquilino le paga directo al propietario
   * (`collector = 'propietario'`): cuánto va a la cuenta del propietario y
   * cuánto a la cuenta de la inmobiliaria (honorarios…). null si cobra la inmobiliaria.
   */
  split: PaymentSplit | null;
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

type OwnerLinkRow = {
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
  owner: { full_name: string | null; cbu: string | null; alias_cbu: string | null; bank_name: string | null } | null;
};

/**
 * Titulares de la propiedad con sus datos bancarios: a dónde le transfiere el
 * inquilino su parte cuando cobra el propietario, y el titular del ingreso en Caja.
 * El principal primero (el marcado; si no, el de mayor %).
 */
export async function propertyOwnersOf(
  admin: AdminClient,
  organizationId: string,
  propertyId: string,
): Promise<{ ok: true; owners: SplitOwnerBank[] } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("rental_property_owners")
    .select("owner_id, ownership_pct, is_primary, owner:owners(full_name, cbu, alias_cbu, bank_name)")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("is_primary", { ascending: false })
    .order("ownership_pct", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return dbFailure("propertyOwnersOf", error, "No se pudieron leer los propietarios de la propiedad.");
  return {
    ok: true,
    owners: ((data ?? []) as unknown as OwnerLinkRow[]).map((r) => ({
      ownerId: r.owner_id,
      name: r.owner?.full_name?.trim() || "Propietario",
      pct: Number(r.ownership_pct),
      isPrimary: !!r.is_primary,
      bankName: r.owner?.bank_name?.trim() || null,
      cbu: r.owner?.cbu?.trim() || null,
      alias: r.owner?.alias_cbu?.trim() || null,
    })),
  };
}

export async function computePaymentPreview(
  admin: AdminClient,
  organizationId: string,
  input: PaymentPreviewInput,
): Promise<
  | { ok: true; preview: PaymentPreview; contract: RentalContract; owners: SplitOwnerBank[]; splitLines: SplitLine[] }
  | { ok: false; error: string }
> {
  const { data: contractData } = await admin
    .from("rental_contracts")
    .select("*")
    .eq("id", input.contractId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const contract = contractData as RentalContract | null;
  if (!contract) return { ok: false, error: "No encontramos el contrato." };

  // Sólo lo que está en la moneda del contrato (la del cobro): un cargo en otra
  // moneda no se paga 1 a 1 con éste (500 dólares no cancelan 500 pesos).
  // Si cobra el propietario, además sus titulares (para el reparto).
  const [{ data: chargesData, error }, ownersRes] = await Promise.all([
    admin
      .from("rental_charges")
      .select("id, label, due_date, subtotal, paid_amount, status, items:rental_charge_items(id, kind, payee, description, amount, original_amount, paid_amount, sort_order, meta)")
      .eq("organization_id", organizationId)
      .eq("contract_id", contract.id)
      .eq("currency", contract.currency)
      .is("voided_at", null)
      .in("status", ["pendiente", "parcial"])
      .order("due_date", { ascending: true }),
    contract.collector === "propietario"
      ? propertyOwnersOf(admin, organizationId, contract.property_id)
      : Promise.resolve({ ok: true as const, owners: [] as SplitOwnerBank[] }),
  ]);
  if (error) return dbFailure("computePaymentPreview:charges", error, "No se pudo leer la cuenta del inquilino.");
  if (!ownersRes.ok) return ownersRes;
  const owners = ownersRes.owners;
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
  const previewAllocations: PreviewAllocation[] = allocations.map((a) => ({
    chargeId: a.chargeId,
    itemId: a.itemId.startsWith("nuevo:") ? null : a.itemId,
    newItemIndex: a.itemId.startsWith("nuevo:") ? Number(a.itemId.slice(6)) : null,
    description: descOf.get(a.itemId) ?? "",
    amount: a.amount,
  }));

  // Cobra el propietario: cuánto le transfiere el inquilino a él y cuánto a la
  // inmobiliaria (honorarios…), con las mismas reglas que la rendición.
  // El depósito va en la parte del propietario (splitLinesFromAllocations): es
  // lo que da por hecho el módulo del depósito cuando cobra el propietario.
  let split: PaymentSplit | null = null;
  let splitLines: SplitLine[] = [];
  if (contract.collector === "propietario") {
    const itemRefs = new Map<string, SplitItemRef>(charges.flatMap((c) => c.items.map((i) => [i.id, { kind: i.kind, payee: i.payee }] as const)));
    splitLines = splitLinesFromAllocations(previewAllocations, itemRefs, contract.late_fee_payee);
    split = splitDirectPayment({
      total: amount,
      lines: splitLines,
      rule: { adminFeePct: Number(contract.admin_fee_pct) || 0, adminFeeVat: !!contract.admin_fee_vat },
      owners,
    });
  }

  return {
    ok: true,
    contract,
    owners,
    splitLines,
    preview: {
      contractId: contract.id,
      currency: contract.currency,
      collector: contract.collector,
      charges: previewCharges,
      lateFees,
      waivedLateFees,
      totalDebt,
      allocations: previewAllocations,
      remainder,
      coversAll: amount >= totalDebt - 0.005,
      split,
    },
  };
}

// ─── Registrar / anular ─────────────────────────────────────────────────────

export interface RegisterPaymentInput extends PaymentPreviewInput {
  method: RentalPaymentMethod;
  /** Cuenta de Caja donde entró la plata. Obligatoria si cobra la inmobiliaria. */
  accountId: string | null;
  /**
   * Cobra el propietario: cuenta de Caja de la inmobiliaria donde entró SU parte
   * (honorarios…). Obligatoria si esa parte es mayor a cero.
   */
  agencyAccountId?: string | null;
  /**
   * Cobra el propietario: cómo le llegó la plata a cada uno (a cada uno su
   * parte, todo al propietario o todo a la inmobiliaria). Los montos son los
   * mismos; queda en la foto del reparto y lo dice el recibo. Sin el dato: 'cada_uno'.
   */
  route?: PaymentRoute | null;
  reference?: string | null;
  payerName?: string | null;
  notes?: string | null;
  /** Aviso de pago del portal que se está registrando. */
  reportId?: string | null;
}

/**
 * Renglones e imputaciones que recibe `rental_register_payment` (068b). Lo usa
 * también el cierre del depósito (lo aplicado a deudas entra por la misma función).
 * Primero los punitorios que se cobran (las imputaciones los apuntan por
 * posición: `new_item_index`) y después las marcas en $ 0 de lo condonado, que
 * ninguna imputación toca. Anular el cobro borra las dos cosas (068b).
 */
export function paymentRpcItems(preview: PaymentPreview, latePayee: RentalPayee, paidAt: string) {
  return {
    p_new_items: [
      ...preview.lateFees.map((f) => ({
        charge_id: f.chargeId,
        kind: "punitorio",
        payee: latePayee,
        description: f.description,
        amount: f.amount,
        meta: { days_late: f.daysLate, base: f.base, as_of: paidAt },
      })),
      ...preview.waivedLateFees.map((f) => ({
        charge_id: f.chargeId,
        kind: "punitorio",
        payee: latePayee,
        description: f.description,
        amount: 0,
        meta: { waived: true, waived_amount: f.amount, days_late: f.daysLate, base: f.base, as_of: paidAt },
      })),
    ],
    p_allocations: preview.allocations.map((a) => ({
      charge_id: a.chargeId,
      item_id: a.itemId,
      new_item_index: a.newItemIndex,
      amount: a.amount,
    })),
  };
}

/**
 * Titular "principal" de la propiedad del contrato (para el owner_id del ingreso
 * en Caja): el marcado; si no, el de mayor %. Es un dato de referencia: si no se
 * puede leer, el ingreso queda sin titular (no frena el cobro).
 */
async function primaryOwnerIdOf(ctx: RentalsCtx, propertyId: string, loaded: readonly SplitOwnerBank[]): Promise<string | null> {
  let owners = loaded;
  if (!owners.length) {
    const res = await propertyOwnersOf(ctx.admin, ctx.organization.id, propertyId);
    if (!res.ok) return null;
    owners = res.owners;
  }
  const i = primaryOwnerIndex(owners);
  return i >= 0 ? owners[i].ownerId : null;
}

/**
 * La base todavía no tiene la 070 (bloques 1–3) y la función vieja registró un
 * cobro con reparto como uno común: sin la foto del reparto (si el contrato
 * pasara a cobrarlo la inmobiliaria, se le volvería a rendir al propietario) y
 * sin la parte de la inmobiliaria en Caja. Se anula en el acto con la función
 * de siempre y se avisa; si ni eso se puede, se dice qué recibo anular.
 */
async function undoPaymentWithoutSplit(
  ctx: RentalsCtx,
  contractId: string,
  paymentId: string,
  receiptNumber: number,
): Promise<{ ok: false; error: string }> {
  const receipt = String(receiptNumber).padStart(6, "0");
  const reason = "Se anuló solo: el sistema todavía no puede registrar cobros con reparto (falta actualizar la base).";
  const { error } = await ctx.admin.rpc("rental_void_payment", {
    p_organization_id: ctx.organization.id,
    p_payment_id: paymentId,
    p_reason: reason,
    p_actor: ctx.session.userId,
  });
  logRentalsError(
    "registerRentalPayment:sin-070",
    `recibo ${receipt}: la base no tiene la migración 070 (rental_register_payment vieja)${error ? `; tampoco se pudo anular: ${error.message}` : "; se anuló"}`,
  );
  if (error) {
    return {
      ok: false,
      error: `El recibo ${receipt} quedó registrado sin el reparto porque falta actualizar el sistema. Anulalo desde la cuenta del inquilino y avisá a soporte antes de volver a cobrarlo.`,
    };
  }
  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId,
    type: "cobro_anulado",
    summary: `Se anuló el recibo ${receipt}: ${reason}`,
    payload: { payment_id: paymentId, reason: "sin_migracion_070" },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return {
    ok: false,
    error: "Todavía no se puede registrar un cobro con reparto: falta actualizar el sistema. El cobro no quedó registrado; avisá a soporte.",
  };
}

export async function registerRentalPayment(
  ctx: RentalsCtx,
  input: RegisterPaymentInput,
): Promise<
  ActionResult<{
    paymentId: string;
    receiptNumber: number;
    remainder: number;
    contractId: string;
    split: PaymentSplit | null;
    /** Ingreso en Caja de los honorarios de un cobro con reparto (null si no hubo). */
    agencyMovementId: string | null;
    /** Ingreso en Caja de lo que la inmobiliaria recibió para pagarle a otro (null si no hubo). */
    passThroughMovementId: string | null;
  }>
> {
  if (!(input.amount > 0)) return { ok: false, error: "Ingresá un importe mayor a cero.", field: "amount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) return { ok: false, error: "La fecha del pago no es válida.", field: "paidAt" };
  if (input.paidAt > ctx.today) return { ok: false, error: "La fecha del pago no puede ser futura.", field: "paidAt" };

  // Todo se vuelve a calcular acá con datos frescos (también el reparto): lo que
  // mandó el navegador sólo aporta el importe, la fecha y las cuentas elegidas.
  const pre = await computePaymentPreview(ctx.admin, ctx.organization.id, input);
  if (!pre.ok) return pre;
  const { preview, contract } = pre;
  if (contract.status === "borrador") return { ok: false, error: "El contrato todavía es un borrador: activalo antes de cobrar." };
  if (contract.collector === "inmobiliaria" && !input.accountId) {
    return { ok: false, error: "Elegí la cuenta de Caja donde entró la plata.", field: "accountId" };
  }
  // Cobra el propietario: sólo la parte de la inmobiliaria entra a Caja.
  const split = contract.collector === "propietario" ? preview.split : null;
  const agencyAccountId = split && split.agency.total > 0 ? input.agencyAccountId || null : null;
  if (split && split.agency.total > 0 && !agencyAccountId) {
    return {
      ok: false,
      error: `Elegí la cuenta de Caja donde entran los ${formatMoney(split.agency.total, contract.currency)} de ${ctx.organization.name} (${agencyPartLabel(split)}).`,
      field: "agencyAccountId",
    };
  }
  const route: PaymentRoute = split && isPaymentRoute(input.route) ? input.route : "cada_uno";
  const ownerId = await primaryOwnerIdOf(ctx, contract.property_id, pre.owners);

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
      // 070: reparto (cobra el propietario). La foto lleva los datos bancarios de hoy.
      // La parte de la inmobiliaria entra a Caja en dos: honorarios (agency_fee) y lo
      // que recibe para pagarle al consorcio o a terceros (rent_collection).
      ...(split
        ? {
            split: splitSnapshot(split, pre.owners, route),
            agency_amount: split.agency.total,
            agency_pass_through: split.agency.passThrough,
            agency_account_id: agencyAccountId,
            agency_movement_description: agencyMovementLabel(split),
            agency_pass_description: passThroughMovementLabel(pre.splitLines),
          }
        : {}),
    },
    ...paymentRpcItems(preview, contract.late_fee_payee, input.paidAt),
  });
  if (error) {
    const failure = dbFailure("registerRentalPayment", error, "No se pudo registrar el cobro. Probá de nuevo.");
    // La cuenta elegida ya no sirve (archivada, otra moneda…): que el diálogo marque el campo.
    if (error.message?.includes("CUENTA_INVALIDA")) failure.field = split ? "agencyAccountId" : "accountId";
    return failure;
  }
  const res = data as {
    payment_id: string;
    receipt_number: number;
    unallocated: number;
    agency_movement_id?: string | null;
    pass_through_movement_id?: string | null;
  };
  if (split && !("agency_movement_id" in res && "pass_through_movement_id" in res)) {
    // La base todavía no tiene la 070 entera: la función vieja ignora el reparto, así
    // que el cobro quedó sin su foto y sin la parte de la inmobiliaria en Caja. Mejor
    // no registrar que registrar mal: se anula en el acto y se avisa.
    return undoPaymentWithoutSplit(ctx, contract.id, res.payment_id, res.receipt_number);
  }
  const waivedTotal = round2(preview.waivedLateFees.reduce((s, f) => s + f.amount, 0));
  const money = (n: number) => formatMoney(n, contract.currency);

  await logRentalEvent(ctx.admin, {
    organizationId: ctx.organization.id,
    contractId: contract.id,
    type: "cobro_registrado",
    summary: `Cobro de ${round2(input.amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${contract.currency} · recibo ${String(res.receipt_number).padStart(6, "0")}${
      preview.lateFees.length ? ` (incluye punitorios por ${round2(preview.lateFees.reduce((s, f) => s + f.amount, 0)).toLocaleString("es-AR")})` : ""
    }${waivedTotal > 0 ? ` · se condonaron punitorios por ${waivedTotal.toLocaleString("es-AR")}` : ""}${
      split
        ? split.agency.total > 0
          ? ` · ${money(split.owner.total)} directo al propietario y ${money(split.agency.total)} a ${ctx.organization.name} (${agencyPartLabel(split)})`
          : " · todo directo al propietario"
        : ""
    }${split && paymentRouteText(route, ctx.organization.name) ? ` · ${paymentRouteText(route, ctx.organization.name)}` : ""}`,
    payload: {
      payment_id: res.payment_id,
      receipt_number: res.receipt_number,
      waived: waivedTotal > 0,
      waived_amount: waivedTotal,
      ...(split
        ? {
            split: {
              route,
              owner_total: split.owner.total,
              agency_total: split.agency.total,
              pass_through: split.agency.passThrough,
              agency_account_id: agencyAccountId,
              agency_movement_id: res.agency_movement_id ?? null,
              pass_through_movement_id: res.pass_through_movement_id ?? null,
            },
          }
        : {}),
    },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return {
    ok: true,
    paymentId: res.payment_id,
    receiptNumber: res.receipt_number,
    remainder: Number(res.unallocated),
    contractId: contract.id,
    split,
    agencyMovementId: res.agency_movement_id ?? null,
    passThroughMovementId: res.pass_through_movement_id ?? null,
  };
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
  // El depósito aplicado a deudas entra como un cobro: anularlo suelto dejaría el
  // depósito "aplicado" con las deudas otra vez abiertas. Se deshace desde la ficha
  // (068h: rental_reopen_deposit lo anula y vuelve el depósito a retenido).
  const { data: dep } = await ctx.admin
    .from("rental_contracts")
    .select("deposit_status, deposit_meta")
    .eq("id", pay.contract_id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  const settlement = (dep?.deposit_meta as { settlement?: { payment_id?: string | null } } | null)?.settlement;
  if (settlement?.payment_id === paymentId) {
    return {
      ok: false,
      error: "Este cobro es el depósito aplicado a deudas. Para anularlo, deshacé el cierre del depósito desde la ficha del contrato.",
    };
  }
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
