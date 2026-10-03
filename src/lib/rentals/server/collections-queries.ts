import "server-only";
import { round2 } from "@/lib/finance/booking-economics";
import type {
  RentalChargeItemKind,
  RentalChargeKind,
  RentalContract,
  RentalMoneyOwner,
  RentalPayee,
  RentalPaymentMethod,
  RentalProperty,
} from "@/lib/types/database";
import {
  chargeDisplayState,
  cyclePositionLabel,
  ITEM_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  propertyAddress,
  type ChargeDisplayState,
} from "@/lib/rentals/labels";
import { buildSchedule } from "@/lib/rentals/schedule";
import { chargingSchedule } from "@/lib/rentals/plan";
import { addDays, monthOf } from "@/lib/rentals/ymd";
import { waivedAmountOf } from "@/lib/rentals/late-fees";
import {
  buildRunningBalance,
  monthEnd,
  rowStateOf,
  totalsByCurrency,
  type BoardGroupKey,
  type LedgerMovement,
  type MoneyTotals,
} from "@/components/rentals/collections/board-helpers";
import type { RentalReceiptData } from "@/lib/pdf/rental-receipt-pdf";
import { getRentalSettings, portalPathOf } from "./contracts";
import { logRentalsError, type AdminClient } from "./access";
import { loadContinuationBilled, withContinuationFlags } from "./continuation";

/**
 * Lecturas de Cobranzas (tablero del mes, cuenta corriente, datos del recibo,
 * aviso de pago y grilla de expensas). Sólo servidor: TODAS filtran por
 * organización — el borde de seguridad es el código, no RLS.
 *
 * `loadReceiptData` también sirve para el portal del inquilino (después de
 * validar el token): no depende de la sesión.
 */

// ─── Compartidos ────────────────────────────────────────────────────────────

export interface TenantLite {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isCompany: boolean;
  docType: string | null;
  docNumber: string | null;
  taxId: string | null;
}

type PropertyLite = Pick<RentalProperty, "id" | "code" | "street" | "street_number" | "floor" | "apartment" | "tower" | "city" | "consortium_name">;

const PROPERTY_COLS = "id, code, street, street_number, floor, apartment, tower, city, consortium_name";

/** Inquilino titular de cada contrato (is_primary; si no hay, el primero). */
async function primaryTenants(admin: AdminClient, orgId: string, contractIds: string[]): Promise<Map<string, TenantLite>> {
  const out = new Map<string, TenantLite>();
  if (!contractIds.length) return out;
  const { data, error } = await admin
    .from("rental_contract_parties")
    .select("contract_id, is_primary, sort_order, person:rental_people(id, full_name, email, phone, person_type, doc_type, doc_number, tax_id)")
    .eq("organization_id", orgId)
    .eq("role", "inquilino")
    .in("contract_id", contractIds)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });
  if (error) logRentalsError("collections:primaryTenants", error);
  type Row = {
    contract_id: string;
    person: {
      id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      person_type: string;
      doc_type: string | null;
      doc_number: string | null;
      tax_id: string | null;
    } | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    if (out.has(r.contract_id) || !r.person) continue;
    out.set(r.contract_id, {
      personId: r.person.id,
      name: r.person.full_name,
      email: r.person.email,
      phone: r.person.phone,
      isCompany: r.person.person_type === "juridica",
      docType: r.person.doc_type,
      docNumber: r.person.doc_number,
      taxId: r.person.tax_id,
    });
  }
  return out;
}

async function propertiesById(admin: AdminClient, orgId: string, ids: string[]): Promise<Map<string, PropertyLite>> {
  const out = new Map<string, PropertyLite>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const { data, error } = await admin.from("rental_properties").select(PROPERTY_COLS).eq("organization_id", orgId).in("id", unique);
  if (error) logRentalsError("collections:properties", error);
  for (const p of (data ?? []) as PropertyLite[]) out.set(p.id, p);
  return out;
}

function addressOf(p: PropertyLite | undefined): string {
  return p ? propertyAddress(p) : "Propiedad sin datos";
}

/** URL absoluta del portal del inquilino, o null si el contrato no lo tiene activo. */
export function portalUrlOf(contract: Pick<RentalContract, "id" | "portal_token_version" | "portal_enabled" | "portal_token_hash">): string | null {
  if (!contract.portal_enabled || !contract.portal_token_hash) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    return `${base}${portalPathOf(contract)}`;
  } catch (e) {
    logRentalsError("collections:portalUrl", e);
    return null;
  }
}

const hasLateFeesOf = (c: Pick<RentalContract, "late_fee_type" | "late_fee_value">) =>
  c.late_fee_type !== "ninguno" && Number(c.late_fee_value) > 0;

// ─── Tablero del mes ────────────────────────────────────────────────────────

export interface BoardChargeRef {
  id: string;
  kind: RentalChargeKind;
  label: string;
  dueDate: string;
  subtotal: number;
  paid: number;
  outstanding: number;
  state: ChargeDisplayState;
}

export interface BoardRow {
  contractId: string;
  contractNumber: number;
  propertyCode: string;
  address: string;
  tenantName: string;
  tenantEmail: string | null;
  tenantPhone: string | null;
  currency: string;
  collector: RentalMoneyOwner;
  periodLabel: string | null;
  state: BoardGroupKey;
  dueDate: string | null;
  total: number;
  paid: number;
  outstanding: number;
  /** Lo que debe de meses anteriores (no entra en el total del mes). */
  previousDebt: number;
  charges: BoardChargeRef[];
  lastPayment: { id: string; receiptNumber: number | null; paidAt: string; amount: number } | null;
  hasLateFees: boolean;
}

export interface PreviousDebtRow {
  contractId: string;
  contractNumber: number;
  address: string;
  tenantName: string;
  tenantEmail: string | null;
  tenantPhone: string | null;
  currency: string;
  amount: number;
  oldestDue: string;
  labels: string[];
  contractStatus: RentalContract["status"];
}

export interface MissingChargeRow {
  contractId: string;
  contractNumber: number;
  address: string;
  tenantName: string;
  periodStart: string;
  dueDate: string;
  /** Día en que el sistema lo genera solo (inicio − días de anticipación). */
  generatesOn: string;
}

export interface CollectionsBoard {
  month: string;
  today: string;
  rows: BoardRow[];
  totals: MoneyTotals[];
  previous: { currency: string; amount: number; contracts: number }[];
  previousRows: PreviousDebtRow[];
  /** Vigentes a los que ya les tocaba el cargo del mes y no lo tienen. */
  missing: MissingChargeRow[];
  /** Cargos del mes que todavía no tocan (se generan solos más adelante). */
  upcoming: MissingChargeRow[];
  chargeLeadDays: number;
  /** Vigentes cuyas expensas cobra la inmobiliaria (para el botón de expensas). */
  expensasContracts: number;
  activeContracts: number;
}

type BoardContract = Pick<
  RentalContract,
  | "id" | "number" | "property_id" | "status" | "currency" | "collector" | "start_date" | "duration_months"
  | "adjustment_every_months" | "payment_window_days" | "billing_starts_on" | "terminated_at"
  | "late_fee_type" | "late_fee_value" | "expensas_mode"
> & {
  /** 068f: se lee aparte y tolerante (withContinuationFlags), no en BOARD_CONTRACT_COLS. */
  continuation_billing?: boolean;
};

const BOARD_CONTRACT_COLS =
  "id, number, property_id, status, currency, collector, start_date, duration_months, adjustment_every_months, payment_window_days, billing_starts_on, terminated_at, late_fee_type, late_fee_value, expensas_mode";

type BoardChargeRow = {
  id: string;
  contract_id: string;
  kind: RentalChargeKind;
  label: string;
  due_date: string;
  subtotal: number;
  paid_amount: number;
  status: string;
  currency: string;
  period_start: string | null;
  index_in_cycle: number | null;
  cycle_length: number | null;
};

const BOARD_CHARGE_COLS = "id, contract_id, kind, label, due_date, subtotal, paid_amount, status, currency, period_start, index_in_cycle, cycle_length";

/** Período del cronograma que arranca dentro del mes (o null si no hay / no se cobra). */
function periodStartingIn(c: BoardContract, month: string, end: string) {
  const base = buildSchedule({
    startDate: c.start_date,
    durationMonths: c.duration_months,
    adjustmentEveryMonths: c.adjustment_every_months,
    paymentWindowDays: c.payment_window_days,
  });
  // Los meses de continuación (art. 1218) se facturan sólo si una persona lo encendió: mismo criterio que ensureContractCharges.
  const schedule = chargingSchedule(base, c, end);
  const p = schedule.find((s) => s.start >= month && s.start <= end);
  if (!p) return null;
  const billingFrom = c.billing_starts_on ?? c.start_date;
  if (p.end < billingFrom) return null;
  if (c.terminated_at && p.start > c.terminated_at) return null;
  return p;
}

/** `.in()` en tandas para no armar URLs gigantes con cientos de ids. */
async function inChunks<T>(ids: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

/** Último recibo (no anulado) imputado a algún cargo del mes, por contrato. */
async function lastPaymentsFor(admin: AdminClient, orgId: string, chargeIds: string[]): Promise<Map<string, BoardRow["lastPayment"]>> {
  type Row = { payment: { id: string; contract_id: string; receipt_number: number | null; paid_at: string; amount: number; voided_at: string | null } | null };
  const rows = await inChunks(chargeIds, 150, async (chunk) => {
    const { data, error } = await admin
      .from("rental_payment_allocations")
      .select("charge_id, payment:rental_payments!inner(id, contract_id, receipt_number, paid_at, amount, voided_at)")
      .eq("organization_id", orgId)
      .in("charge_id", chunk);
    if (error) logRentalsError("collections:lastPayments", error);
    return (data ?? []) as unknown as Row[];
  });
  const out = new Map<string, BoardRow["lastPayment"]>();
  for (const { payment: p } of rows) {
    if (!p || p.voided_at) continue;
    const prev = out.get(p.contract_id);
    if (!prev || p.paid_at > prev.paidAt || (p.paid_at === prev.paidAt && (p.receipt_number ?? 0) > (prev.receiptNumber ?? 0))) {
      out.set(p.contract_id, { id: p.id, receiptNumber: p.receipt_number, paidAt: p.paid_at, amount: Number(p.amount) });
    }
  }
  return out;
}

export async function loadCollectionsBoard(
  admin: AdminClient,
  orgId: string,
  month: string,
  today: string,
): Promise<CollectionsBoard & { failed: boolean }> {
  const end = monthEnd(month);
  const monthFilter = `and(kind.eq.mensual,period_start.gte.${month},period_start.lte.${end}),and(kind.neq.mensual,due_date.gte.${month},due_date.lte.${end})`;
  const prevFilter = `and(kind.eq.mensual,period_start.lt.${month}),and(kind.neq.mensual,due_date.lt.${month})`;
  const [monthRes, prevRes, vigRes, settings, continuationOn] = await Promise.all([
    admin.from("rental_charges").select(BOARD_CHARGE_COLS).eq("organization_id", orgId).is("voided_at", null).or(monthFilter),
    admin
      .from("rental_charges")
      .select(BOARD_CHARGE_COLS)
      .eq("organization_id", orgId)
      .is("voided_at", null)
      .in("status", ["pendiente", "parcial"])
      .or(prevFilter),
    admin.from("rental_contracts").select(BOARD_CONTRACT_COLS).eq("organization_id", orgId).eq("status", "vigente"),
    getRentalSettings(admin, orgId),
    loadContinuationBilled(admin, orgId),
  ]);
  const failed = !!(monthRes.error || prevRes.error || vigRes.error);
  if (monthRes.error) logRentalsError("collections:board:month", monthRes.error);
  if (prevRes.error) logRentalsError("collections:board:prev", prevRes.error);
  if (vigRes.error) logRentalsError("collections:board:contracts", vigRes.error);

  const monthCharges = (monthRes.data ?? []) as BoardChargeRow[];
  const prevCharges = ((prevRes.data ?? []) as BoardChargeRow[]).filter((c) => Number(c.subtotal) - Number(c.paid_amount) > 0.004);
  const vig = ((vigRes.data ?? []) as BoardContract[]).map((c) => ({ ...c, continuation_billing: continuationOn.has(c.id) }));
  const contracts = new Map<string, BoardContract>(vig.map((c) => [c.id, c]));
  const otherIds = [...new Set([...monthCharges, ...prevCharges].map((c) => c.contract_id))].filter((id) => !contracts.has(id));
  if (otherIds.length) {
    const others = await inChunks(otherIds, 150, async (chunk) => {
      const { data } = await admin.from("rental_contracts").select(BOARD_CONTRACT_COLS).eq("organization_id", orgId).in("id", chunk);
      return (data ?? []) as BoardContract[];
    });
    for (const c of others) contracts.set(c.id, c);
  }

  const ids = [...contracts.keys()];
  const [tenants, props, lastPays] = await Promise.all([
    primaryTenants(admin, orgId, ids),
    propertiesById(admin, orgId, [...contracts.values()].map((c) => c.property_id)),
    lastPaymentsFor(admin, orgId, monthCharges.map((c) => c.id)),
  ]);

  const group = (list: BoardChargeRow[]) => {
    const m = new Map<string, BoardChargeRow[]>();
    for (const ch of list) m.set(ch.contract_id, [...(m.get(ch.contract_id) ?? []), ch]);
    return m;
  };
  const byContract = group(monthCharges);
  const prevByContract = group(prevCharges);
  const outstandingOf = (ch: BoardChargeRow) => Math.max(0, round2(Number(ch.subtotal) - Number(ch.paid_amount)));

  const rows: BoardRow[] = [];
  for (const [contractId, charges] of byContract) {
    const c = contracts.get(contractId);
    if (!c) continue;
    const tenant = tenants.get(contractId);
    const refs: BoardChargeRef[] = charges.map((ch) => ({
      id: ch.id,
      kind: ch.kind,
      label: ch.label,
      dueDate: ch.due_date,
      subtotal: Number(ch.subtotal),
      paid: Math.min(Number(ch.paid_amount), Number(ch.subtotal)),
      outstanding: outstandingOf(ch),
      state: chargeDisplayState({ ...ch, subtotal: Number(ch.subtotal), paid_amount: Number(ch.paid_amount) }, today),
    }));
    refs.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    const open = refs.filter((r) => r.outstanding > 0.004);
    const monthly = charges.find((ch) => ch.kind === "mensual");
    rows.push({
      contractId,
      contractNumber: c.number,
      propertyCode: props.get(c.property_id)?.code ?? "",
      address: addressOf(props.get(c.property_id)),
      tenantName: tenant?.name ?? "Sin inquilino",
      tenantEmail: tenant?.email ?? null,
      tenantPhone: tenant?.phone ?? null,
      currency: c.currency,
      collector: c.collector,
      periodLabel: monthly ? cyclePositionLabel(monthly.index_in_cycle, monthly.cycle_length) : null,
      state: rowStateOf(charges.map((ch) => ({ ...ch, subtotal: Number(ch.subtotal), paid_amount: Number(ch.paid_amount) })), today),
      dueDate: open[0]?.dueDate ?? monthly?.due_date ?? refs[0]?.dueDate ?? null,
      total: round2(refs.reduce((s, r) => s + r.subtotal, 0)),
      paid: round2(refs.reduce((s, r) => s + r.paid, 0)),
      outstanding: round2(refs.reduce((s, r) => s + r.outstanding, 0)),
      previousDebt: round2((prevByContract.get(contractId) ?? []).reduce((s, ch) => s + outstandingOf(ch), 0)),
      charges: refs,
      lastPayment: lastPays.get(contractId) ?? null,
      hasLateFees: hasLateFeesOf(c),
    });
  }

  const previousRows: PreviousDebtRow[] = [];
  for (const [contractId, charges] of prevByContract) {
    const c = contracts.get(contractId);
    if (!c) continue;
    const tenant = tenants.get(contractId);
    const sorted = [...charges].sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    previousRows.push({
      contractId,
      contractNumber: c.number,
      address: addressOf(props.get(c.property_id)),
      tenantName: tenant?.name ?? "Sin inquilino",
      tenantEmail: tenant?.email ?? null,
      tenantPhone: tenant?.phone ?? null,
      currency: c.currency,
      amount: round2(sorted.reduce((s, ch) => s + outstandingOf(ch), 0)),
      oldestDue: sorted[0].due_date,
      labels: sorted.map((ch) => ch.label),
      contractStatus: c.status,
    });
  }
  previousRows.sort((a, b) => (a.oldestDue < b.oldestDue ? -1 : a.oldestDue > b.oldestDue ? 1 : b.amount - a.amount));
  const prevTotals = new Map<string, { currency: string; amount: number; contracts: number }>();
  for (const r of previousRows) {
    const t = prevTotals.get(r.currency) ?? { currency: r.currency, amount: 0, contracts: 0 };
    t.amount = round2(t.amount + r.amount);
    t.contracts += 1;
    prevTotals.set(r.currency, t);
  }

  const leadDays = Math.max(0, Number(settings.charge_lead_days) || 0);
  const horizon = addDays(today, leadDays);
  const missing: MissingChargeRow[] = [];
  const upcoming: MissingChargeRow[] = [];
  for (const c of vig) {
    if ((byContract.get(c.id) ?? []).some((ch) => ch.kind === "mensual")) continue;
    const p = periodStartingIn(c, month, end);
    if (!p) continue;
    const row: MissingChargeRow = {
      contractId: c.id,
      contractNumber: c.number,
      address: addressOf(props.get(c.property_id)),
      tenantName: tenants.get(c.id)?.name ?? "Sin inquilino",
      periodStart: p.start,
      dueDate: p.dueDate,
      generatesOn: addDays(p.start, -leadDays),
    };
    (p.start <= horizon ? missing : upcoming).push(row);
  }
  upcoming.sort((a, b) => (a.generatesOn < b.generatesOn ? -1 : 1));

  return {
    failed,
    month,
    today,
    rows,
    totals: totalsByCurrency(monthCharges.map((ch) => ({ ...ch, subtotal: Number(ch.subtotal), paid_amount: Number(ch.paid_amount) })), today),
    previous: [...prevTotals.values()].sort((a, b) => b.amount - a.amount),
    previousRows,
    missing,
    upcoming,
    chargeLeadDays: leadDays,
    expensasContracts: vig.filter((c) => c.expensas_mode === "cobra_inmobiliaria").length,
    activeContracts: vig.length,
  };
}

// ─── Cuenta corriente del contrato ──────────────────────────────────────────

export interface LedgerItem {
  id: string;
  kind: RentalChargeItemKind;
  kindLabel: string;
  payee: RentalPayee;
  description: string;
  amount: number;
  originalAmount: number | null;
  discountReason: string | null;
  /** Intereses condonados al cobrar: el ítem es una marca en $ 0 que guarda cuánto se perdonó. */
  waivedAmount: number;
  paid: number;
  outstanding: number;
}

export interface LedgerCharge {
  id: string;
  kind: RentalChargeKind;
  label: string;
  periodLabel: string | null;
  dueDate: string;
  issueDate: string;
  /**
   * Cuándo se devenga el cargo, para ordenar el saldo corrido: el inicio del
   * período en los mensuales (el alquiler se paga por adelantado: un pago del 9
   * para un cargo que vence el 10 no deja "a favor" entre medio) y, en los
   * demás, la emisión o el vencimiento, lo que sea antes. No usa la fecha de
   * creación: los cargos de períodos pasados se crean al activar el contrato.
   */
  accruedOn: string;
  subtotal: number;
  paid: number;
  outstanding: number;
  state: ChargeDisplayState;
  voided: boolean;
  voidReason: string | null;
  hasPayments: boolean;
  items: LedgerItem[];
  createdAt: string;
}

export interface LedgerPayment {
  id: string;
  paidAt: string;
  amount: number;
  method: RentalPaymentMethod;
  methodLabel: string;
  accountName: string | null;
  reference: string | null;
  payerName: string | null;
  receiptNumber: number | null;
  unallocated: number;
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
  allocations: { chargeId: string; chargeLabel: string; description: string; amount: number }[];
  /** Ya se le rindió al propietario (no se puede anular sin anular la rendición). */
  statementNumber: number | null;
}

export interface ContractLedger {
  today: string;
  contract: {
    id: string;
    number: number;
    currency: string;
    collector: RentalMoneyOwner;
    /** Quién guarda el depósito según el contrato (un renglón de depósito va para él). */
    depositHolder: RentalMoneyOwner;
    status: RentalContract["status"];
    address: string;
    tenantName: string;
    tenantEmail: string | null;
    tenantPhone: string | null;
    hasLateFees: boolean;
  };
  charges: LedgerCharge[];
  payments: LedgerPayment[];
  movements: LedgerMovement[];
  totals: { billed: number; paid: number; outstanding: number; overdue: number; credit: number; balance: number };
}

type LedgerChargeRow = {
  id: string;
  kind: RentalChargeKind;
  label: string;
  due_date: string;
  issue_date: string;
  period_start: string | null;
  index_in_cycle: number | null;
  cycle_length: number | null;
  subtotal: number;
  paid_amount: number;
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  items: {
    id: string;
    kind: RentalChargeItemKind;
    payee: RentalPayee;
    description: string;
    amount: number;
    original_amount: number | null;
    discount_reason: string | null;
    paid_amount: number;
    sort_order: number;
    meta: Record<string, unknown> | null;
  }[];
};

type LedgerPaymentRow = {
  id: string;
  paid_at: string;
  amount: number;
  method: RentalPaymentMethod;
  account_id: string | null;
  reference: string | null;
  payer_name: string | null;
  receipt_number: number | null;
  unallocated_amount: number;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  allocations: { id: string; charge_id: string; charge_item_id: string; amount: number }[];
};

/** Número de rendición (no anulada) en la que quedó cada imputación. */
async function statementNumbersByAllocation(admin: AdminClient, orgId: string, allocationIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!allocationIds.length) return out;
  const lines = await inChunks(allocationIds, 150, async (chunk) => {
    const { data } = await admin
      .from("rental_owner_statement_lines")
      .select("ref_id, statement_id")
      .eq("organization_id", orgId)
      .eq("ref_type", "allocation")
      .eq("voided", false)
      .in("ref_id", chunk);
    return (data ?? []) as { ref_id: string; statement_id: string }[];
  });
  const statementIds = [...new Set(lines.map((l) => l.statement_id))];
  if (!statementIds.length) return out;
  const { data: sts } = await admin.from("rental_owner_statements").select("id, number, status").eq("organization_id", orgId).in("id", statementIds);
  const num = new Map(((sts ?? []) as { id: string; number: number; status: string }[]).filter((s) => s.status !== "anulada").map((s) => [s.id, s.number]));
  for (const l of lines) {
    const n = num.get(l.statement_id);
    if (n != null) out.set(l.ref_id, n);
  }
  return out;
}

export async function loadContractLedger(
  admin: AdminClient,
  orgId: string,
  contractId: string,
  today: string,
): Promise<ContractLedger | null> {
  const [cRes, chRes, payRes] = await Promise.all([
    admin
      .from("rental_contracts")
      .select("id, number, currency, collector, status, property_id, late_fee_type, late_fee_value, deposit_holder")
      .eq("id", contractId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("rental_charges")
      .select(
        "id, kind, label, due_date, issue_date, period_start, index_in_cycle, cycle_length, subtotal, paid_amount, status, voided_at, void_reason, created_at, items:rental_charge_items(id, kind, payee, description, amount, original_amount, discount_reason, paid_amount, sort_order, meta)",
      )
      .eq("organization_id", orgId)
      .eq("contract_id", contractId)
      .order("due_date", { ascending: true }),
    admin
      .from("rental_payments")
      .select(
        "id, paid_at, amount, method, account_id, reference, payer_name, receipt_number, unallocated_amount, voided_at, void_reason, created_at, allocations:rental_payment_allocations(id, charge_id, charge_item_id, amount)",
      )
      .eq("organization_id", orgId)
      .eq("contract_id", contractId)
      .order("paid_at", { ascending: true }),
  ]);
  if (chRes.error) logRentalsError("collections:ledger:charges", chRes.error);
  if (payRes.error) logRentalsError("collections:ledger:payments", payRes.error);
  const c = cRes.data as (Pick<RentalContract, "id" | "number" | "currency" | "collector" | "status" | "property_id" | "late_fee_type" | "late_fee_value" | "deposit_holder">) | null;
  if (!c) return null;
  const chargeRows = (chRes.data ?? []) as unknown as LedgerChargeRow[];
  const payRows = (payRes.data ?? []) as unknown as LedgerPaymentRow[];

  const accountIds = [...new Set(payRows.map((p) => p.account_id).filter((x): x is string => !!x))];
  const allocIds = payRows.flatMap((p) => p.allocations.map((a) => a.id));
  const [tenants, props, accRes, stByAlloc] = await Promise.all([
    primaryTenants(admin, orgId, [c.id]),
    propertiesById(admin, orgId, [c.property_id]),
    accountIds.length
      ? admin.from("cash_accounts").select("id, name").eq("organization_id", orgId).in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    statementNumbersByAllocation(admin, orgId, allocIds),
  ]);
  const accountName = new Map(((accRes.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const chargeLabel = new Map(chargeRows.map((ch) => [ch.id, ch.label]));
  const itemDesc = new Map(chargeRows.flatMap((ch) => ch.items.map((i) => [i.id, i.description] as const)));
  const allocatedCharges = new Set(payRows.filter((p) => !p.voided_at).flatMap((p) => p.allocations.map((a) => a.charge_id)));

  const charges: LedgerCharge[] = chargeRows.map((ch) => {
    const subtotal = Number(ch.subtotal);
    const paid = Math.min(Number(ch.paid_amount), subtotal);
    const voided = !!ch.voided_at || ch.status === "anulado";
    return {
      id: ch.id,
      kind: ch.kind,
      label: ch.label,
      periodLabel: cyclePositionLabel(ch.index_in_cycle, ch.cycle_length),
      dueDate: ch.due_date,
      issueDate: ch.issue_date,
      accruedOn: ch.period_start ?? (ch.issue_date < ch.due_date ? ch.issue_date : ch.due_date),
      subtotal,
      paid,
      outstanding: voided ? 0 : Math.max(0, round2(subtotal - paid)),
      state: chargeDisplayState({ status: ch.status, due_date: ch.due_date, subtotal, paid_amount: paid, voided_at: ch.voided_at }, today),
      voided,
      voidReason: ch.void_reason,
      hasPayments: paid > 0 || allocatedCharges.has(ch.id),
      createdAt: ch.created_at,
      items: [...ch.items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: i.id,
          kind: i.kind,
          kindLabel: ITEM_KIND_LABEL[i.kind] ?? i.kind,
          payee: i.payee,
          description: i.description,
          amount: Number(i.amount),
          originalAmount: i.original_amount == null ? null : Number(i.original_amount),
          discountReason: i.discount_reason,
          waivedAmount: i.kind === "punitorio" ? waivedAmountOf(i.meta) : 0,
          paid: Number(i.paid_amount),
          outstanding: Math.max(0, round2(Number(i.amount) - Number(i.paid_amount))),
        })),
    };
  });

  const payments: LedgerPayment[] = payRows.map((p) => ({
    id: p.id,
    paidAt: p.paid_at,
    amount: Number(p.amount),
    method: p.method,
    methodLabel: PAYMENT_METHOD_LABEL[p.method] ?? p.method,
    accountName: p.account_id ? accountName.get(p.account_id) ?? null : null,
    reference: p.reference,
    payerName: p.payer_name,
    receiptNumber: p.receipt_number,
    unallocated: p.voided_at ? 0 : Number(p.unallocated_amount),
    voided: !!p.voided_at,
    voidReason: p.void_reason,
    createdAt: p.created_at,
    allocations: p.allocations.map((a) => ({
      chargeId: a.charge_id,
      chargeLabel: chargeLabel.get(a.charge_id) ?? "Cargo",
      description: itemDesc.get(a.charge_item_id) ?? "",
      amount: Number(a.amount),
    })),
    statementNumber: p.allocations.map((a) => stByAlloc.get(a.id)).find((n) => n != null) ?? null,
  }));

  const movements = buildRunningBalance(
    charges.map((ch) => ({ id: ch.id, date: ch.accruedOn, createdAt: ch.createdAt, subtotal: ch.subtotal, voided: ch.voided })),
    payments.map((p) => ({ id: p.id, date: p.paidAt, createdAt: p.createdAt, amount: p.amount, voided: p.voided })),
  );
  const live = charges.filter((ch) => !ch.voided);
  const outstanding = round2(live.reduce((s, ch) => s + ch.outstanding, 0));
  const credit = round2(payments.reduce((s, p) => s + p.unallocated, 0));
  const tenant = tenants.get(c.id);
  return {
    today,
    contract: {
      id: c.id,
      number: c.number,
      currency: c.currency,
      collector: c.collector,
      depositHolder: c.deposit_holder,
      status: c.status,
      address: addressOf(props.get(c.property_id)),
      tenantName: tenant?.name ?? "Sin inquilino",
      tenantEmail: tenant?.email ?? null,
      tenantPhone: tenant?.phone ?? null,
      hasLateFees: hasLateFeesOf(c),
    },
    charges,
    payments,
    movements,
    totals: {
      billed: round2(live.reduce((s, ch) => s + ch.subtotal, 0)),
      paid: round2(live.reduce((s, ch) => s + ch.paid, 0)),
      outstanding,
      overdue: round2(live.filter((ch) => ch.dueDate < today).reduce((s, ch) => s + ch.outstanding, 0)),
      credit,
      balance: round2(outstanding - credit),
    },
  };
}

// ─── Diálogo de cobro ───────────────────────────────────────────────────────

export interface PaymentSetup {
  today: string;
  contract: {
    id: string;
    number: number;
    status: RentalContract["status"];
    currency: string;
    collector: RentalMoneyOwner;
    address: string;
    tenantName: string;
    tenantEmail: string | null;
    tenantPhone: string | null;
    lateFeeHint: string | null;
  };
  /** Cuentas de Caja activas en la moneda del contrato. */
  accounts: { id: string; name: string; type: string; isDefault: boolean }[];
}

export async function loadPaymentSetup(admin: AdminClient, orgId: string, contractId: string, today: string): Promise<PaymentSetup | null> {
  const { data } = await admin
    .from("rental_contracts")
    .select("id, number, status, currency, collector, property_id, late_fee_type, late_fee_value, grace_days")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const c = data as (Pick<RentalContract, "id" | "number" | "status" | "currency" | "collector" | "property_id" | "late_fee_type" | "late_fee_value" | "grace_days">) | null;
  if (!c) return null;
  const [tenants, props, accRes] = await Promise.all([
    primaryTenants(admin, orgId, [c.id]),
    propertiesById(admin, orgId, [c.property_id]),
    admin
      .from("cash_accounts")
      .select("id, name, type, is_expense_default, display_order")
      .eq("organization_id", orgId)
      .eq("active", true)
      .eq("currency", c.currency)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);
  if (accRes.error) logRentalsError("collections:setup:accounts", accRes.error);
  const tenant = tenants.get(c.id);
  const value = Number(c.late_fee_value).toLocaleString("es-AR");
  const lateFeeHint =
    c.late_fee_type === "ninguno" || !(Number(c.late_fee_value) > 0)
      ? null
      : c.late_fee_type === "diario_pct"
        ? `${value} % diario sobre el alquiler adeudado`
        : c.late_fee_type === "mensual_pct"
          ? `${value} % mensual sobre el alquiler adeudado`
          : `${value} ${c.currency} por día de atraso`;
  return {
    today,
    contract: {
      id: c.id,
      number: c.number,
      status: c.status,
      currency: c.currency,
      collector: c.collector,
      address: addressOf(props.get(c.property_id)),
      tenantName: tenant?.name ?? "Sin inquilino",
      tenantEmail: tenant?.email ?? null,
      tenantPhone: tenant?.phone ?? null,
      lateFeeHint: lateFeeHint && c.grace_days > 0 ? `${lateFeeHint} (con ${c.grace_days} días de gracia)` : lateFeeHint,
    },
    accounts: ((accRes.data ?? []) as { id: string; name: string; type: string; is_expense_default: boolean | null }[]).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      isDefault: !!a.is_expense_default,
    })),
  };
}

// ─── Datos del recibo ───────────────────────────────────────────────────────

type OpenChargeRow = { id: string; label: string; due_date: string; subtotal: number; paid_amount: number };

/** Lo que sigue abierto de un contrato, lo más viejo primero. */
async function openChargesOf(admin: AdminClient, orgId: string, contractId: string): Promise<OpenChargeRow[]> {
  const { data, error } = await admin
    .from("rental_charges")
    .select("id, label, due_date, subtotal, paid_amount")
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .is("voided_at", null)
    .in("status", ["pendiente", "parcial"])
    .order("due_date", { ascending: true });
  if (error) logRentalsError("collections:openCharges", error);
  return ((data ?? []) as OpenChargeRow[]).filter((c) => Number(c.subtotal) - Number(c.paid_amount) > 0.004);
}

/**
 * Todo lo que necesita el PDF del recibo. Independiente de la sesión: el
 * portal del inquilino lo puede usar después de validar su token.
 */
export async function loadReceiptData(admin: AdminClient, orgId: string, paymentId: string, today: string): Promise<RentalReceiptData | null> {
  const { data: payData } = await admin
    .from("rental_payments")
    .select(
      "id, contract_id, paid_at, amount, currency, method, account_id, reference, payer_name, receipt_number, unallocated_amount, voided_at, void_reason, created_by, allocations:rental_payment_allocations(amount, item:rental_charge_items(description, sort_order), charge:rental_charges(label, due_date))",
    )
    .eq("id", paymentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  type PayRow = {
    id: string;
    contract_id: string;
    paid_at: string;
    amount: number;
    currency: string;
    method: RentalPaymentMethod;
    account_id: string | null;
    reference: string | null;
    payer_name: string | null;
    receipt_number: number | null;
    unallocated_amount: number;
    voided_at: string | null;
    void_reason: string | null;
    created_by: string | null;
    allocations: { amount: number; item: { description: string; sort_order: number } | null; charge: { label: string; due_date: string } | null }[];
  };
  const pay = payData as unknown as PayRow | null;
  if (!pay) return null;

  const [orgRes, cRes, settings, tenants, open, accRes, profRes] = await Promise.all([
    admin.from("organizations").select("name, legal_name, tax_id, logo_url, primary_color, address, contact_phone, contact_email").eq("id", orgId).maybeSingle(),
    admin.from("rental_contracts").select("id, number, property_id, collector").eq("id", pay.contract_id).eq("organization_id", orgId).maybeSingle(),
    getRentalSettings(admin, orgId),
    primaryTenants(admin, orgId, [pay.contract_id]),
    openChargesOf(admin, orgId, pay.contract_id),
    pay.account_id
      ? admin.from("cash_accounts").select("name").eq("id", pay.account_id).eq("organization_id", orgId).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
    pay.created_by
      ? admin.from("user_profiles").select("full_name").eq("user_id", pay.created_by).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
  ]);
  const org = orgRes.data as (RentalReceiptData["org"]) | null;
  const contract = cRes.data as (Pick<RentalContract, "id" | "number" | "property_id" | "collector">) | null;
  if (!org || !contract) return null;
  const props = await propertiesById(admin, orgId, [contract.property_id]);
  const property = props.get(contract.property_id);
  const tenant = tenants.get(contract.id);

  const lines = [...pay.allocations]
    .sort((a, b) => (a.charge?.due_date ?? "").localeCompare(b.charge?.due_date ?? "") || (a.item?.sort_order ?? 0) - (b.item?.sort_order ?? 0))
    .map((a) => ({ chargeLabel: a.charge?.label ?? "-", description: a.item?.description ?? "Pago", amount: Number(a.amount) }));
  if (pay.voided_at && !lines.length) {
    lines.push({ chargeLabel: "-", description: "Cobro anulado: la imputación se deshizo al anularlo", amount: Number(pay.amount) });
  }

  return {
    org,
    broker: { name: settings.broker_name, license: settings.broker_license },
    receipt: {
      id: pay.id,
      number: pay.receipt_number,
      paidAt: pay.paid_at,
      amount: Number(pay.amount),
      currency: pay.currency,
      methodLabel: PAYMENT_METHOD_LABEL[pay.method] ?? pay.method,
      reference: pay.reference,
      accountName: (accRes.data as { name: string } | null)?.name ?? null,
      collectedByOwner: contract.collector === "propietario",
      payerName: pay.payer_name,
      voided: !!pay.voided_at,
      voidedAt: pay.voided_at,
      voidReason: pay.void_reason,
      issuedBy: (profRes.data as { full_name: string | null } | null)?.full_name ?? null,
    },
    contract: { id: contract.id, number: contract.number, address: addressOf(property), city: property?.city ?? null },
    tenant: {
      name: tenant?.name ?? "Inquilino",
      docType: tenant?.docType ?? null,
      docNumber: tenant?.docNumber ?? null,
      taxId: tenant?.taxId ?? null,
      email: tenant?.email ?? null,
      phone: tenant?.phone ?? null,
      isCompany: tenant?.isCompany ?? false,
    },
    lines,
    creditLeft: pay.voided_at ? 0 : Number(pay.unallocated_amount),
    pending: {
      asOf: today,
      total: round2(open.reduce((s, c) => s + Number(c.subtotal) - Number(c.paid_amount), 0)),
      items: open.map((c) => ({ label: c.label, dueDate: c.due_date, outstanding: round2(Number(c.subtotal) - Number(c.paid_amount)) })),
    },
    footer: settings.receipt_footer,
  };
}

// ─── Aviso de pago ──────────────────────────────────────────────────────────

export interface ReminderData {
  today: string;
  org: { name: string; primary_color: string | null; logo_url: string | null; contact_email: string | null; contact_phone: string | null };
  contractId: string;
  contractNumber: number;
  address: string;
  currency: string;
  tenant: TenantLite | null;
  lines: { label: string; dueDate: string; outstanding: number }[];
  hasLateFees: boolean;
  paymentInstructions: string | null;
  portalUrl: string | null;
}

export async function loadReminderData(admin: AdminClient, orgId: string, contractId: string, today: string): Promise<ReminderData | null> {
  const [cRes, orgRes] = await Promise.all([
    admin
      .from("rental_contracts")
      .select("id, number, property_id, currency, late_fee_type, late_fee_value, portal_enabled, portal_token_hash, portal_token_version")
      .eq("id", contractId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.from("organizations").select("name, primary_color, logo_url, contact_email, contact_phone").eq("id", orgId).maybeSingle(),
  ]);
  type C = Pick<
    RentalContract,
    "id" | "number" | "property_id" | "currency" | "late_fee_type" | "late_fee_value" | "portal_enabled" | "portal_token_hash" | "portal_token_version"
  >;
  const c = cRes.data as C | null;
  const org = orgRes.data as ReminderData["org"] | null;
  if (!c || !org) return null;
  const [tenants, props, open, settings] = await Promise.all([
    primaryTenants(admin, orgId, [c.id]),
    propertiesById(admin, orgId, [c.property_id]),
    openChargesOf(admin, orgId, c.id),
    getRentalSettings(admin, orgId),
  ]);
  return {
    today,
    org,
    contractId: c.id,
    contractNumber: c.number,
    address: addressOf(props.get(c.property_id)),
    currency: c.currency,
    tenant: tenants.get(c.id) ?? null,
    lines: open.map((ch) => ({ label: ch.label, dueDate: ch.due_date, outstanding: round2(Number(ch.subtotal) - Number(ch.paid_amount)) })),
    hasLateFees: hasLateFeesOf(c),
    paymentInstructions: settings.payment_instructions,
    portalUrl: portalUrlOf(c),
  };
}

// ─── Expensas del mes (contratos cuyas expensas cobra la inmobiliaria) ──────

export interface ExpensasGridRow {
  contractId: string;
  contractNumber: number;
  address: string;
  consortium: string | null;
  tenantName: string;
  currency: string;
  /** Cargo mensual del mes (null si todavía no se generó). */
  chargeId: string | null;
  chargeLabel: string | null;
  chargeState: ChargeDisplayState | null;
  itemId: string | null;
  amount: number | null;
  /** Lo que ya se cobró de las expensas de este mes (no se puede bajar de ahí). */
  paidOnItem: number;
  /** Expensas del mes anterior (sugerencia). */
  lastAmount: number | null;
  blockedReason: string | null;
}

export async function loadExpensasGrid(admin: AdminClient, orgId: string, month: string, today: string): Promise<ExpensasGridRow[]> {
  const { data: cData, error } = await admin
    .from("rental_contracts")
    .select(BOARD_CONTRACT_COLS)
    .eq("organization_id", orgId)
    .eq("status", "vigente")
    .eq("expensas_mode", "cobra_inmobiliaria")
    .order("number", { ascending: true });
  if (error) logRentalsError("collections:expensas:contracts", error);
  const contracts = await withContinuationFlags(admin, orgId, (cData ?? []) as BoardContract[]);
  if (!contracts.length) return [];
  const ids = contracts.map((c) => c.id);
  const end = monthEnd(month);
  const prevMonth = monthOf(addDays(month, -1));
  type Ch = {
    id: string;
    contract_id: string;
    label: string;
    period_start: string;
    due_date: string;
    status: string;
    subtotal: number;
    paid_amount: number;
    items: { id: string; kind: RentalChargeItemKind; amount: number; paid_amount: number }[];
  };
  const [tenants, props, charges] = await Promise.all([
    primaryTenants(admin, orgId, ids),
    propertiesById(admin, orgId, contracts.map((c) => c.property_id)),
    inChunks(ids, 150, async (chunk) => {
      const { data, error: chErr } = await admin
        .from("rental_charges")
        .select("id, contract_id, label, period_start, due_date, status, subtotal, paid_amount, items:rental_charge_items(id, kind, amount, paid_amount)")
        .eq("organization_id", orgId)
        .eq("kind", "mensual")
        .is("voided_at", null)
        .in("contract_id", chunk)
        .gte("period_start", prevMonth)
        .lte("period_start", end);
      if (chErr) logRentalsError("collections:expensas:charges", chErr);
      return (data ?? []) as unknown as Ch[];
    }),
  ]);
  return contracts.map((c) => {
    const current = charges.find((ch) => ch.contract_id === c.id && ch.period_start >= month);
    const previous = charges.find((ch) => ch.contract_id === c.id && ch.period_start < month);
    const item = current?.items.find((i) => i.kind === "expensas") ?? null;
    const lastItems = previous?.items.filter((i) => i.kind === "expensas") ?? [];
    const property = props.get(c.property_id);
    const expected = periodStartingIn(c, month, end);
    return {
      contractId: c.id,
      contractNumber: c.number,
      address: addressOf(property),
      consortium: property?.consortium_name ?? null,
      tenantName: tenants.get(c.id)?.name ?? "Sin inquilino",
      currency: c.currency,
      chargeId: current?.id ?? null,
      chargeLabel: current?.label ?? null,
      chargeState: current
        ? chargeDisplayState({ ...current, subtotal: Number(current.subtotal), paid_amount: Number(current.paid_amount) }, today)
        : null,
      itemId: item?.id ?? null,
      amount: item ? Number(item.amount) : null,
      paidOnItem: item ? Number(item.paid_amount) : 0,
      lastAmount: lastItems.length ? round2(lastItems.reduce((s, i) => s + Number(i.amount), 0)) : null,
      blockedReason: current
        ? null
        : expected
          ? "Todavía no se generó el cargo de este mes."
          : "Este mes no tiene alquiler para cobrar en este contrato.",
    };
  });
}
