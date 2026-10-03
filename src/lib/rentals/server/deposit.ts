import "server-only";
import { round2 } from "@/lib/finance/booking-economics";
import { zonedTimeToUtc } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { RentalContract, RentalMoneyOwner, RentalPayee } from "@/lib/types/database";
import {
  checkDepositSettlement,
  depositAllocationBlocker,
  depositCurrencyOf,
  depositHeldAmount,
  depositItemBlocker,
  depositItemPayee,
  depositPlace,
  isDepositSettled,
  suggestDepositSplit,
  type DepositFlags,
  type DepositItemRef,
} from "@/lib/rentals/deposit";
import { formatContractNumber } from "@/lib/rentals/labels";
import { isYmd } from "@/lib/rentals/ymd";
import { logRentalEvent } from "./contract-sync";
import { computePaymentPreview, paymentRpcItems } from "./payments";
import { dbFailure, logRentalsError, type ActionResult, type AdminClient, type RentalsCtx } from "./access";

/**
 * Depósito en garantía (068h): marcarlo cobrado cuando no pasó por la cuenta
 * del inquilino, cerrarlo al terminar el contrato (devuelto, aplicado a lo que
 * quedó debiendo o pasado a la renovación) y deshacer ese cierre. Lo que mueve
 * plata va en UNA función de la base: el cobro aplicado, el egreso de Caja y
 * el estado del depósito se escriben juntos o no se escribe nada.
 */

interface DepositMeta {
  received?: { on?: string | null; movement_id?: string | null } | null;
  /** held_by (068j): dónde estaba la plata en el contrato anterior. */
  inherited?: { from_contract_id?: string; from_number?: number; amount?: number; currency?: string; on?: string; held_by?: RentalMoneyOwner } | null;
  settlement?: {
    outcome?: "cerrar" | "renovacion";
    applied?: number;
    returned?: number;
    allocated?: boolean;
    payment_id?: string | null;
    receipt_number?: number | null;
    movement_id?: string | null;
    renewal_id?: string | null;
    renewal_number?: number | null;
    settled_on?: string | null;
    note?: string | null;
  } | null;
}

type DepositContract = Pick<
  RentalContract,
  | "id"
  | "number"
  | "status"
  | "property_id"
  | "currency"
  | "collector"
  | "deposit_amount"
  | "deposit_currency"
  | "deposit_holder"
  | "deposit_status"
  | "deposit_returned_amount"
  | "deposit_returned_at"
  | "renewed_from_id"
> & { deposit_meta: DepositMeta | null };

const COLS =
  "id, number, status, property_id, currency, collector, deposit_amount, deposit_currency, deposit_holder, deposit_status, deposit_returned_amount, deposit_returned_at, renewed_from_id, deposit_meta";

async function loadDepositContract(admin: AdminClient, orgId: string, contractId: string): Promise<DepositContract | null> {
  const { data } = await admin.from("rental_contracts").select(COLS).eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  return (data as DepositContract | null) ?? null;
}

const isEnded = (c: Pick<RentalContract, "status">) => c.status === "finalizado" || c.status === "rescindido";

/** La función todavía no existe en la base (migración sin aplicar). */
const isMissingRpc = (e: { code?: string } | null | undefined) => e?.code === "PGRST202" || e?.code === "42883";

/**
 * Renglones 'deposito' vivos de la cuenta del inquilino (cargos sin anular): si
 * hay, el estado lo lleva ese cobro (trigger de la 068h) y su destinatario dice
 * dónde está la plata (depositPlace). null = no se pudo leer.
 */
async function loadDepositItems(admin: AdminClient, orgId: string, contractId: string): Promise<DepositItemRef[] | null> {
  const { data, error } = await admin
    .from("rental_charge_items")
    .select("amount, payee, paid_amount, charge:rental_charges!inner(contract_id, voided_at)")
    .eq("organization_id", orgId)
    .eq("kind", "deposito")
    .eq("charge.contract_id", contractId)
    .is("charge.voided_at", null);
  if (error) {
    logRentalsError("deposit:items", error);
    return null;
  }
  return ((data ?? []) as { amount: number; payee: string; paid_amount: number }[]).map((i) => ({ payee: i.payee, amount: Number(i.amount), paid: Number(i.paid_amount) }));
}

const isTracked = (items: readonly DepositItemRef[]) => items.reduce((s, i) => s + Number(i.amount), 0) > 0;

/** Banderas para la ficha (qué acciones del depósito ofrecer). Una consulta sólo si el depósito sigue abierto. */
export async function loadDepositFlags(
  ctx: RentalsCtx,
  c: Pick<RentalContract, "id" | "status" | "deposit_amount" | "deposit_status" | "collector" | "deposit_holder">,
): Promise<DepositFlags> {
  // deposit_meta (068h) viene en el select("*") de la ficha.
  const meta = ((c as { deposit_meta?: DepositMeta | null }).deposit_meta ?? {}) as DepositMeta;
  const open = Number(c.deposit_amount) > 0 && c.status !== "borrador" && (c.deposit_status === "pendiente" || c.deposit_status === "retenido");
  // Si no se pudo leer, la ficha muestra lo del contrato: es sólo para mostrar (el cierre vuelve a leer).
  const items = (open ? await loadDepositItems(ctx.admin, ctx.organization.id, c.id) : null) ?? [];
  return {
    tracked: isTracked(items),
    receivedManually: Boolean(meta.received),
    inheritedFromNumber: meta.inherited?.from_number ?? null,
    heldBy: depositPlace({ collector: c.collector, deposit_holder: c.deposit_holder, deposit_meta: meta }, items).heldBy,
  };
}

/**
 * Antes de cargar a mano un renglón de depósito (cargo extra, agregar
 * concepto): sólo si el depósito se puede cobrar por la cuenta, y siempre para
 * quien lo guarda según el contrato —lo mismo que arma activateContract—. Si se
 * eligiera otro destinatario, un depósito que guarda la inmobiliaria se le
 * rendiría al propietario y al cerrarlo saldría de Caja una plata que ya no está.
 */
export async function depositItemGate(
  admin: AdminClient,
  orgId: string,
  contractId: string,
): Promise<{ ok: true; payee: RentalPayee } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("rental_contracts")
    .select("currency, deposit_amount, deposit_currency, deposit_status, deposit_holder, deposit_meta")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    logRentalsError("deposit:itemGate", error);
    return { ok: false, error: "No se pudo revisar el depósito del contrato. Probá de nuevo." };
  }
  const c = data as
    | (Pick<RentalContract, "currency" | "deposit_amount" | "deposit_currency" | "deposit_status" | "deposit_holder"> & { deposit_meta: DepositMeta | null })
    | null;
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  const blocked = depositItemBlocker(c);
  if (blocked) return { ok: false, error: blocked };
  return { ok: true, payee: depositItemPayee(c.deposit_holder) };
}

export interface DepositSetup {
  today: string;
  contract: {
    id: string;
    number: number;
    status: RentalContract["status"];
    ended: boolean;
    currency: string;
    collector: RentalContract["collector"];
    depositAmount: number;
    depositCurrency: string;
    /** Quién tiene la plata de verdad (depositPlace), no sólo lo que dice el contrato: decide si la devolución sale de Caja. */
    holder: RentalContract["deposit_holder"];
    /** Por qué `holder` no es lo que dice el contrato (null = es eso). */
    holderNote: string | null;
    /** Lo que está de verdad en garantía (depositHeldAmount): con cuotas anuladas puede ser menos que depositAmount. */
    heldAmount: number;
    /** Estado crudo (incluye 'trasladado', de la 068h). */
    depositStatus: string;
  };
  /** Hay renglón de depósito en la cuenta: queda cobrado cuando se registra ese cobro. */
  tracked: boolean;
  /** null = lo aplicado a deudas se imputa solo a la cuenta; si no, por qué no. */
  blocker: string | null;
  /** Lo que quedó debiendo hoy (con intereses al día). null si lo aplicado no se imputa. */
  debt: number | null;
  suggestion: { applied: number; returned: number };
  /** Contrato que este renueva: si su depósito sigue retenido, lo que corresponde es pasarlo desde ahí. */
  previous: { id: string; number: number; depositStatus: string } | null;
  /** Renovación de este contrato (la más nueva), para pasarle el depósito. */
  renewal: { id: string; number: number; status: RentalContract["status"]; depositAmount: number; depositCurrency: string; depositStatus: string } | null;
  /** Cuentas de Caja activas en la moneda del depósito (sólo si lo guarda la inmobiliaria). */
  accounts: { id: string; name: string; isDefault: boolean }[];
  inheritedFrom: { contractId: string; number: number | null } | null;
  receivedManually: boolean;
  settlement: DepositMeta["settlement"] | null;
}

export async function getDepositSetup(ctx: RentalsCtx, contractId: string): Promise<ActionResult<{ setup: DepositSetup }>> {
  const org = ctx.organization.id;
  const c = await loadDepositContract(ctx.admin, org, contractId);
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  if (!(Number(c.deposit_amount) > 0)) return { ok: false, error: "El contrato no tiene depósito." };
  const depositCurrency = depositCurrencyOf(c);
  const ended = isEnded(c);
  // Primero dónde está la plata: de eso sale si se imputa solo y si la devolución sale de Caja.
  const items = await loadDepositItems(ctx.admin, org, c.id);
  if (!items) return { ok: false, error: "No se pudo leer el depósito. Probá de nuevo." };
  const place = depositPlace(c, items);
  const heldAmount = depositHeldAmount(c, items);
  const blocker = depositAllocationBlocker(c, place.heldBy);

  const [renewalRes, accRes, debt, previousRes] = await Promise.all([
    ctx.admin
      .from("rental_contracts")
      .select("id, number, status, currency, deposit_amount, deposit_currency, deposit_status")
      .eq("organization_id", org)
      .eq("renewed_from_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1),
    place.heldBy === "inmobiliaria"
      ? ctx.admin
          .from("cash_accounts")
          .select("id, name, is_expense_default, display_order")
          .eq("organization_id", org)
          .eq("active", true)
          .eq("currency", depositCurrency)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    ended && !blocker ? openDebt(ctx, c.id) : Promise.resolve(null),
    c.renewed_from_id
      ? ctx.admin.from("rental_contracts").select("id, number, deposit_status").eq("id", c.renewed_from_id).eq("organization_id", org).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const prev = previousRes.data as { id: string; number: number; deposit_status: string } | null;
  if (accRes.error) logRentalsError("deposit:accounts", accRes.error);
  type R = { id: string; number: number; status: RentalContract["status"]; currency: string; deposit_amount: number; deposit_currency: string | null; deposit_status: string };
  const r = ((renewalRes.data ?? []) as R[])[0] ?? null;
  const meta = c.deposit_meta ?? {};

  return {
    ok: true,
    setup: {
      today: ctx.today,
      contract: {
        id: c.id,
        number: c.number,
        status: c.status,
        ended,
        currency: c.currency,
        collector: c.collector,
        depositAmount: Number(c.deposit_amount),
        depositCurrency,
        holder: place.heldBy,
        holderNote: place.note,
        heldAmount,
        depositStatus: c.deposit_status,
      },
      tracked: isTracked(items),
      blocker,
      debt,
      suggestion: suggestDepositSplit(heldAmount, debt),
      previous: prev ? { id: prev.id, number: prev.number, depositStatus: prev.deposit_status } : null,
      renewal: r
        ? { id: r.id, number: r.number, status: r.status, depositAmount: Number(r.deposit_amount), depositCurrency: r.deposit_currency || r.currency, depositStatus: r.deposit_status }
        : null,
      accounts: ((accRes.data ?? []) as { id: string; name: string; is_expense_default: boolean | null }[]).map((a) => ({
        id: a.id,
        name: a.name,
        isDefault: !!a.is_expense_default,
      })),
      inheritedFrom: meta.inherited?.from_contract_id ? { contractId: meta.inherited.from_contract_id, number: meta.inherited.from_number ?? null } : null,
      receivedManually: Boolean(meta.received),
      settlement: meta.settlement ?? null,
    },
  };
}

/** Lo que el inquilino debe hoy (con los intereses al día), en la moneda del contrato. */
async function openDebt(ctx: RentalsCtx, contractId: string): Promise<number | null> {
  const pre = await computePaymentPreview(ctx.admin, ctx.organization.id, { contractId, amount: 0, paidAt: ctx.today });
  return pre.ok ? pre.preview.totalDebt : null;
}

export interface DepositApplicationPreview {
  /** Deuda a esa fecha, con los intereses que nacen (o se condonan). */
  debt: number;
  lines: { description: string; amount: number }[];
  lateFeesTotal: number;
  waivedTotal: number;
}

/** Qué paga lo aplicado del depósito (misma imputación que un cobro, a la fecha del cierre). */
export async function previewDepositApplication(
  ctx: RentalsCtx,
  contractId: string,
  input: { applied: number; date: string; waiveLateFees: boolean },
): Promise<ActionResult<{ preview: DepositApplicationPreview }>> {
  const c = await loadDepositContract(ctx.admin, ctx.organization.id, contractId);
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  const items = await loadDepositItems(ctx.admin, ctx.organization.id, c.id);
  if (!items) return { ok: false, error: "No se pudo leer el depósito. Probá de nuevo." };
  const blocker = depositAllocationBlocker(c, depositPlace(c, items).heldBy);
  if (blocker) return { ok: false, error: blocker };
  const pre = await computePaymentPreview(ctx.admin, ctx.organization.id, {
    contractId,
    amount: round2(Math.max(0, input.applied)),
    paidAt: input.date,
    waiveLateFees: input.waiveLateFees,
  });
  if (!pre.ok) return pre;
  const p = pre.preview;
  return {
    ok: true,
    preview: {
      debt: p.totalDebt,
      lines: p.allocations.map((a) => ({ description: a.description, amount: a.amount })),
      lateFeesTotal: round2(p.lateFees.reduce((s, f) => s + f.amount, 0)),
      waivedTotal: round2(p.waivedLateFees.reduce((s, f) => s + f.amount, 0)),
    },
  };
}

function ddmmyyyy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

const receiptLabel = (n: number | null | undefined) => (n ? ` (recibo ${String(n).padStart(6, "0")})` : "");

// ─── Marcar cobrado (depósito que no pasó por la cuenta) ────────────────────

/**
 * Contratos que ya venían corriendo o depósito en otra moneda: no hay renglón
 * de depósito en la cuenta, así que lo marca una persona. Si lo guarda la
 * inmobiliaria puede anotar en qué cuenta de Caja entró (así la devolución, al
 * final, sale de una plata que Caja conoce). `received: false` deshace la marca.
 */
export async function markDepositReceived(
  ctx: RentalsCtx,
  contractId: string,
  input: { received: boolean; date: string; accountId: string | null },
): Promise<ActionResult<{ movementId: string | null }>> {
  const org = ctx.organization.id;
  const c = await loadDepositContract(ctx.admin, org, contractId);
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  const date = isYmd(input.date) ? input.date : ctx.today;
  if (input.received && date > ctx.today) return { ok: false, error: "La fecha no puede ser futura.", field: "date" };
  if (input.received && input.accountId && c.deposit_holder !== "inmobiliaria") {
    return { ok: false, error: "El depósito lo guarda el propietario: no entra a la Caja de la inmobiliaria.", field: "accountId" };
  }
  // Marcarlo otra vez pisaría el registro del primer ingreso en Caja: quedaría
  // bloqueado allá sin nada en Alquileres que lo pueda deshacer (la 068j también lo frena).
  if (input.received && c.deposit_meta?.received) {
    const on = c.deposit_meta.received.on;
    return {
      ok: false,
      error: `El depósito ya figura cobrado a mano${on && isYmd(on) ? ` desde el ${ddmmyyyy(on)}` : ""}. Si hay que corregir la fecha o la cuenta, desmarcalo primero y volvé a marcarlo.`,
    };
  }
  const { data, error } = await ctx.admin.rpc("rental_mark_deposit_received", {
    p_organization_id: org,
    p_contract_id: c.id,
    p_input: {
      received: input.received,
      received_on: date,
      account_id: input.received ? input.accountId : null,
      occurred_at: zonedTimeToUtc(date, "12:00", ctx.tz).toISOString(),
      description: `Depósito en garantía · ${formatContractNumber(c.number)}`,
      actor: ctx.session.userId,
    },
  });
  if (error) return dbFailure("markDepositReceived", error, "No se pudo guardar el estado del depósito.");
  const movementId = (data as { movement_id?: string | null } | null)?.movement_id ?? null;
  const amount = formatMoney(Number(c.deposit_amount), depositCurrencyOf(c));
  await logRentalEvent(ctx.admin, {
    organizationId: org,
    contractId: c.id,
    propertyId: c.property_id,
    type: input.received ? "deposito_cobrado" : "deposito_desmarcado",
    summary: input.received
      ? `Depósito de ${amount} marcado como cobrado el ${ddmmyyyy(date)} (no pasó por la cuenta del inquilino)${movementId ? "; entró a Caja" : ""}.`
      : `Se deshizo la marca de depósito cobrado${movementId ? " y se borró su ingreso en Caja" : ""}.`,
    payload: { movement_id: movementId },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, movementId };
}

// ─── Cerrar al terminar el contrato ─────────────────────────────────────────

export interface SettleDepositInput {
  outcome: "cerrar" | "renovacion";
  /** Lo que se aplica a lo que quedó debiendo. */
  applied: number;
  /** Lo que se le devuelve al inquilino. */
  returned: number;
  date: string;
  accountId: string | null;
  note: string;
  waiveLateFees: boolean;
}

export async function settleDeposit(
  ctx: RentalsCtx,
  contractId: string,
  input: SettleDepositInput,
): Promise<ActionResult<{ status: string; receiptNumber: number | null; renewalId: string | null; caja: boolean }>> {
  const org = ctx.organization.id;
  const c = await loadDepositContract(ctx.admin, org, contractId);
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  if (!isEnded(c)) return { ok: false, error: "El depósito se cierra cuando termina el contrato: finalizalo o rescindilo primero." };
  if (!(Number(c.deposit_amount) > 0)) return { ok: false, error: "El contrato no tiene depósito." };
  if (isDepositSettled(c.deposit_status)) return { ok: false, error: "El depósito ya está cerrado." };
  if (c.deposit_status !== "retenido") return { ok: false, error: "El depósito no figura cobrado: marcalo como cobrado antes de cerrarlo." };
  if (!isYmd(input.date) || input.date > ctx.today) return { ok: false, error: "La fecha no puede ser futura.", field: "date" };
  const note = input.note.trim().slice(0, 300);
  const currency = depositCurrencyOf(c);
  const noteTail = note ? ` Nota: ${note}` : "";

  // Dónde está la plata de verdad (068j): un depósito cobrado «para el
  // propietario» ya se le rindió, así que ni se le imputa otra vez ni sale de Caja.
  const items = await loadDepositItems(ctx.admin, org, c.id);
  if (!items) return { ok: false, error: "No se pudo leer el depósito. Probá de nuevo." };
  const place = depositPlace(c, items);
  // Y cuánto: con cuotas de depósito anuladas, lo cobrado (no el monto del contrato).
  const basis = depositHeldAmount(c, items);
  const depositLabel = formatMoney(basis, currency);
  let heldBy: RentalMoneyOwner = place.heldBy;
  if (heldBy !== c.deposit_holder) {
    // Sin la 068j la base cierra según lo que dice el contrato y, con la plata en
    // otro lado, movería Caja o le rendiría de más: se confirma con la base nueva.
    const probe = await ctx.admin.rpc("rental_deposit_holder", { p_organization_id: org, p_contract_id: c.id });
    if (probe.error) {
      if (isMissingRpc(probe.error)) {
        return { ok: false, error: `${place.note ?? "El depósito no está donde dice el contrato."} Para cerrarlo así falta una actualización del sistema: probá de nuevo en un rato.` };
      }
      return dbFailure("settleDeposit:holder", probe.error, "No se pudo revisar dónde está el depósito. Probá de nuevo.");
    }
    if (probe.data === "propietario" || probe.data === "inmobiliaria") heldBy = probe.data;
  }

  if (input.outcome === "renovacion") {
    const { data, error } = await ctx.admin.rpc("rental_settle_deposit", {
      p_organization_id: org,
      p_contract_id: c.id,
      // holder: la renovación hereda dónde está la plata (la 068j lo verifica y lo guarda).
      p_settlement: { outcome: "renovacion", settled_on: input.date, note: note || null, actor: ctx.session.userId, holder: heldBy, basis },
      p_new_items: [],
      p_allocations: [],
    });
    if (error) return dbFailure("settleDeposit:renewal", error, "No se pudo pasar el depósito a la renovación.");
    const res = data as { renewal_id: string; renewal_number: number };
    await logRentalEvent(ctx.admin, {
      organizationId: org,
      contractId: c.id,
      propertyId: c.property_id,
      type: "deposito_trasladado",
      summary: `El depósito de ${depositLabel} pasó a la renovación ${formatContractNumber(res.renewal_number)}: sigue en garantía.${noteTail}`,
      payload: { renewal_id: res.renewal_id, held_by: heldBy },
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
    await logRentalEvent(ctx.admin, {
      organizationId: org,
      contractId: res.renewal_id,
      propertyId: c.property_id,
      type: "deposito_heredado",
      summary: `Sigue en garantía el depósito de ${depositLabel} del contrato ${formatContractNumber(c.number)}.`,
      payload: { from_contract_id: c.id },
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
    return { ok: true, status: "trasladado", receiptNumber: null, renewalId: res.renewal_id, caja: false };
  }

  const applied = round2(input.applied);
  const returned = round2(input.returned);
  // Lo aplicado entra como cobro sólo si la plata está donde entran los cobros
  // (depositAllocationBlocker); si no, queda anotado y los cargos se bonifican a mano.
  const allocate = applied > 0 && !depositAllocationBlocker(c, heldBy);
  let rpcItems: ReturnType<typeof paymentRpcItems> = { p_new_items: [], p_allocations: [] };
  let debt: number | null = null;
  if (allocate) {
    const pre = await computePaymentPreview(ctx.admin, org, { contractId: c.id, amount: applied, paidAt: input.date, waiveLateFees: input.waiveLateFees });
    if (!pre.ok) return pre;
    debt = pre.preview.totalDebt;
    rpcItems = paymentRpcItems(pre.preview, pre.contract.late_fee_payee, input.date);
  }
  const check = checkDepositSettlement({ depositAmount: basis, currency, applied, returned, debt, note });
  if (!check.ok) return { ok: false, error: check.error, field: check.field };
  const fromCaja = returned > 0 && heldBy === "inmobiliaria";
  if (fromCaja && !input.accountId) return { ok: false, error: "Elegí la cuenta de Caja de la que sale la devolución.", field: "accountId" };

  const occurredAt = zonedTimeToUtc(input.date, "12:00", ctx.tz).toISOString();
  const { data, error } = await ctx.admin.rpc("rental_settle_deposit", {
    p_organization_id: org,
    p_contract_id: c.id,
    p_settlement: {
      outcome: "cerrar",
      applied,
      returned,
      allocate,
      settled_on: input.date,
      account_id: fromCaja ? input.accountId : null,
      occurred_at: occurredAt,
      description: `Devolución del depósito · ${formatContractNumber(c.number)}`,
      note: note || null,
      actor: ctx.session.userId,
      // La 068j vuelve a calcular dónde está la plata y cuánto con el contrato
      // bloqueado, y frena si no coincide (entró o se anuló un renglón de depósito).
      holder: heldBy,
      basis,
      payment: {
        method: "otro",
        reference: "Depósito en garantía",
        notes: "Pagado con el depósito en garantía al cerrar el contrato.",
        occurred_at: occurredAt,
      },
    },
    ...rpcItems,
  });
  if (error) return dbFailure("settleDeposit", error, "No se pudo cerrar el depósito. Probá de nuevo.");
  const res = data as { status: string; receipt_number: number | null; movement_id: string | null };

  const parts = [
    applied > 0
      ? allocate
        ? `se aplicaron ${formatMoney(applied, currency)} a lo que quedó debiendo${receiptLabel(res.receipt_number)}`
        : `se descontaron ${formatMoney(applied, currency)} por deudas (anotado: los cargos se bonifican desde la cuenta corriente)`
      : null,
    returned > 0
      ? fromCaja
        ? `se le devolvieron ${formatMoney(returned, currency)} al inquilino desde Caja`
        : `el propietario le devolvió ${formatMoney(returned, currency)} al inquilino`
      : null,
  ].filter(Boolean);
  await logRentalEvent(ctx.admin, {
    organizationId: org,
    contractId: c.id,
    propertyId: c.property_id,
    type: "deposito_cerrado",
    summary: `Depósito de ${depositLabel} cerrado el ${ddmmyyyy(input.date)}: ${parts.join(" y ")}.${noteTail}`,
    payload: { applied, returned, allocated: allocate, receipt_number: res.receipt_number, movement_id: res.movement_id },
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  return { ok: true, status: res.status, receiptNumber: res.receipt_number ?? null, renewalId: null, caja: Boolean(res.movement_id) };
}

// ─── Deshacer el cierre ─────────────────────────────────────────────────────

export async function reopenDeposit(
  ctx: RentalsCtx,
  contractId: string,
  reason: string,
): Promise<ActionResult<{ renewalId: string | null; caja: boolean }>> {
  const clean = reason.trim();
  if (clean.length < 3) return { ok: false, error: "Contá brevemente por qué se deshace (queda en el historial).", field: "reason" };
  const org = ctx.organization.id;
  const c = await loadDepositContract(ctx.admin, org, contractId);
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  if (!isDepositSettled(c.deposit_status)) return { ok: false, error: "El depósito no está cerrado." };
  const { data, error } = await ctx.admin.rpc("rental_reopen_deposit", {
    p_organization_id: org,
    p_contract_id: c.id,
    p_reason: `Se deshizo el cierre del depósito: ${clean}`.slice(0, 300),
    p_actor: ctx.session.userId,
  });
  if (error) return dbFailure("reopenDeposit", error, "No se pudo deshacer el cierre del depósito.");
  const res = data as { voided_payment_id: string | null; deleted_movement_id: string | null; renewal_id: string | null };
  const undone = [
    res.voided_payment_id ? "se anuló el cobro con que se había aplicado a deudas" : null,
    res.deleted_movement_id ? "se borró la devolución de Caja" : null,
    res.renewal_id ? "la renovación ya no lo tiene en garantía" : null,
  ].filter(Boolean);
  await logRentalEvent(ctx.admin, {
    organizationId: org,
    contractId: c.id,
    propertyId: c.property_id,
    type: "deposito_reabierto",
    summary: `Se deshizo el cierre del depósito${undone.length ? ` (${undone.join("; ")})` : ""}: ${clean}`,
    payload: res,
    actorId: ctx.session.userId,
    actorName: ctx.actorName,
  });
  if (res.renewal_id) {
    await logRentalEvent(ctx.admin, {
      organizationId: org,
      contractId: res.renewal_id,
      propertyId: c.property_id,
      type: "deposito_heredado_deshecho",
      summary: `Se deshizo el traspaso del depósito del contrato ${formatContractNumber(c.number)}.`,
      payload: { from_contract_id: c.id },
      actorId: ctx.session.userId,
      actorName: ctx.actorName,
    });
  }
  return { ok: true, renewalId: res.renewal_id, caja: Boolean(res.deleted_movement_id || res.voided_payment_id) };
}
