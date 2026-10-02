import "server-only";
import type {
  RentalAdjustment,
  RentalContract,
  RentalContractParty,
  RentalPerson,
  RentalProperty,
  RentalPropertyOwner,
} from "@/lib/types/database";
import { contractDisplayState, cyclePositionLabel, formatContractNumber, propertyAddress } from "@/lib/rentals/labels";
import { amountToSpanishWords } from "@/lib/rentals/words";
import { rentForPeriod } from "@/lib/rentals/adjustments";
import { INDEX_META, isIndexCode } from "@/lib/rentals/indices";
import {
  appliedMapOf,
  buildContractPlan,
  projectedContractTotal,
  rentInForceOn,
  skippedSetOf,
  stipulatedContractValue,
  type PlanContract,
} from "@/lib/rentals/plan";
import { contractEndDate, periodAt } from "@/lib/rentals/schedule";
import { diffDays, monthOf } from "@/lib/rentals/ymd";
import { adjustmentSummary, lagExample, mergeAdjustments, type AdjustmentRow } from "@/components/rentals/contracts/adjustment-view";
import { computeEntryBreakdown } from "@/components/rentals/contracts/entry-breakdown";
import type {
  ContractDetailData,
  ContractFormOptions,
  ContractListResult,
  ContractListRow,
  ContractListView,
  PersonOption,
  PlanPreview,
  PropertyOption,
} from "@/components/rentals/contracts/types";
import type { PlanPreviewInput } from "@/components/rentals/contracts/wizard-state";
import type { IntimationData } from "@/components/rentals/contracts/intimation-text";
import { getRentalSettings, portalPathOf } from "./contracts";
import { loadSeriesForContract } from "./series";
import type { AdminClient, RentalsCtx } from "./access";

/**
 * Lecturas de la tajada Contratos (lista, ficha, alta). Todo filtra por la
 * org de `ctx` (service role: la base no frena nada).
 */

/** Tope de exención de Sellos de Córdoba 2026 (Ley Impositiva, art. 48) si la org no cargó otro. */
export const STAMP_EXEMPT_FALLBACK_2026 = 1_230_000;

const PAGE = 1000;

/** PostgREST corta en 1000 filas: lee de a páginas (máx. 20k filas). */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function docLabelOf(p: Pick<RentalPerson, "doc_type" | "doc_number" | "tax_id">): string | null {
  if (p.doc_number) return `${p.doc_type && p.doc_type !== "OTRO" ? `${p.doc_type} ` : ""}${p.doc_number}`;
  if (p.tax_id) return `CUIT ${p.tax_id}`;
  return null;
}

type PropertyRow = Pick<
  RentalProperty,
  "id" | "code" | "property_type" | "street" | "street_number" | "floor" | "apartment" | "tower" | "city" | "listing_rent" | "listing_currency"
>;
const PROPERTY_COLS = "id, code, property_type, street, street_number, floor, apartment, tower, city, listing_rent, listing_currency";

export async function loadOwnerNames(admin: AdminClient, orgId: string, ids: string[]): Promise<Map<string, { name: string; phone: string | null; email: string | null }>> {
  const map = new Map<string, { name: string; phone: string | null; email: string | null }>();
  if (!ids.length) return map;
  const { data } = await admin.from("owners").select("id, full_name, phone, email").eq("organization_id", orgId).in("id", [...new Set(ids)]);
  for (const o of (data ?? []) as { id: string; full_name: string; phone: string | null; email: string | null }[]) {
    map.set(o.id, { name: o.full_name, phone: o.phone, email: o.email });
  }
  return map;
}

export async function loadContractFormOptions(ctx: RentalsCtx): Promise<ContractFormOptions> {
  const orgId = ctx.organization.id;
  const [props, links, busy, people, owners, accounts, settings] = await Promise.all([
    fetchAll<PropertyRow>((a, b) =>
      ctx.admin.from("rental_properties").select(PROPERTY_COLS).eq("organization_id", orgId).eq("active", true).order("code").range(a, b),
    ),
    fetchAll<Pick<RentalPropertyOwner, "property_id" | "owner_id" | "ownership_pct" | "is_primary">>((a, b) =>
      ctx.admin.from("rental_property_owners").select("property_id, owner_id, ownership_pct, is_primary").eq("organization_id", orgId).range(a, b),
    ),
    fetchAll<Pick<RentalContract, "id" | "number" | "status" | "property_id" | "end_date">>((a, b) =>
      ctx.admin
        .from("rental_contracts")
        .select("id, number, status, property_id, end_date")
        .eq("organization_id", orgId)
        .in("status", ["vigente", "borrador"])
        .range(a, b),
    ),
    fetchAll<RentalPerson>((a, b) =>
      ctx.admin
        .from("rental_people")
        .select("id, full_name, person_type, doc_type, doc_number, tax_id, phone, email, employer, monthly_income")
        .eq("organization_id", orgId)
        .eq("active", true)
        .order("full_name")
        .range(a, b),
    ),
    fetchAll<{ id: string; full_name: string }>((a, b) =>
      ctx.admin.from("owners").select("id, full_name").eq("organization_id", orgId).eq("active", true).order("full_name").range(a, b),
    ),
    ctx.admin.from("cash_accounts").select("id, name, currency").eq("organization_id", orgId).eq("active", true).order("display_order"),
    getRentalSettings(ctx.admin, orgId),
  ]);

  const ownerName = new Map(owners.map((o) => [o.id, o.full_name]));
  const byProperty = new Map<string, PropertyOption["owners"]>();
  for (const l of links) {
    const list = byProperty.get(l.property_id) ?? [];
    list.push({ ownerId: l.owner_id, name: ownerName.get(l.owner_id) ?? "Propietario", pct: Number(l.ownership_pct), isPrimary: l.is_primary });
    byProperty.set(l.property_id, list);
  }
  const busyBy = new Map<string, PropertyOption["busyWith"]>();
  for (const c of busy) {
    const prev = busyBy.get(c.property_id);
    if (!prev || (c.status === "vigente" && prev.status !== "vigente")) {
      busyBy.set(c.property_id, { contractId: c.id, number: c.number, status: c.status, endDate: c.end_date });
    }
  }
  const properties: PropertyOption[] = props.map((p) => ({
    id: p.id,
    code: p.code,
    address: propertyAddress(p),
    city: p.city,
    propertyType: p.property_type,
    owners: (byProperty.get(p.id) ?? []).sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || y.pct - x.pct),
    busyWith: busyBy.get(p.id) ?? null,
    listingRent: p.listing_rent != null ? Number(p.listing_rent) : null,
    listingCurrency: p.listing_currency,
  }));
  const personOptions: PersonOption[] = people.map((p) => ({
    id: p.id,
    fullName: p.full_name,
    personType: p.person_type,
    docLabel: docLabelOf(p),
    phone: p.phone,
    email: p.email,
    employer: p.employer,
    monthlyIncome: p.monthly_income != null ? Number(p.monthly_income) : null,
  }));
  return {
    properties,
    people: personOptions,
    owners: owners.map((o) => ({ id: o.id, name: o.full_name })),
    accounts: ((accounts.data ?? []) as { id: string; name: string; currency: string }[]).map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    settings: {
      payment_window_days: settings.payment_window_days,
      grace_days: settings.grace_days,
      late_fee_type: settings.late_fee_type,
      late_fee_value: Number(settings.late_fee_value),
      late_fee_payee: settings.late_fee_payee,
      admin_fee_pct: Number(settings.admin_fee_pct),
      admin_fee_vat: settings.admin_fee_vat,
      tenant_commission: settings.tenant_commission,
      owner_commission: settings.owner_commission,
      default_index: settings.default_index,
      default_adjustment_every: settings.default_adjustment_every,
      default_lag_months: settings.default_lag_months,
      default_rounding: settings.default_rounding,
      default_duration_months: settings.default_duration_months,
      stamp_tax_rate_pct: Number(settings.stamp_tax_rate_pct),
      stamp_tax_exempt_monthly: settings.stamp_tax_exempt_monthly != null ? Number(settings.stamp_tax_exempt_monthly) : STAMP_EXEMPT_FALLBACK_2026,
      stamp_tax_tenant_share_pct: Number(settings.stamp_tax_tenant_share_pct),
      auto_apply_adjustments: settings.auto_apply_adjustments,
      vat_condition: settings.vat_condition,
    },
    today: ctx.today,
  };
}

// ─── Lista ──────────────────────────────────────────────────────────────────

const LIST_COLS =
  "id, number, status, property_id, start_date, end_date, duration_months, currency, initial_rent, current_rent, adjustment_method, index_code, adjustment_every_months, index_lag_months, fixed_pct, steps, rounding, cap_pct, allow_decrease, payment_window_days, terminated_at";

const ADJ_COLS =
  "contract_id, sequence, period_index, effective_date, status, from_key, to_key, variation_pct, base_amount, computed_amount, applied_amount, override_reason, notified_at";

type ListContract = Pick<
  RentalContract,
  "id" | "number" | "status" | "property_id" | "start_date" | "end_date" | "duration_months" | "currency" | "initial_rent" | "current_rent" | "terminated_at"
> &
  PlanContract;

export function viewOfRow(r: Pick<ContractListRow, "status" | "displayState">): ContractListView[] {
  if (r.status === "borrador") return ["borradores"];
  if (r.status === "finalizado" || r.status === "rescindido") return ["terminados"];
  return r.displayState === "por_vencer" || r.displayState === "vencido_ocupado" ? ["vigentes", "por_vencer"] : ["vigentes"];
}

export async function loadContractList(ctx: RentalsCtx): Promise<ContractListResult> {
  const orgId = ctx.organization.id;
  const today = ctx.today;
  const empty: ContractListResult = { rows: [], counts: { vigentes: 0, por_vencer: 0, borradores: 0, terminados: 0 }, total: 0 };
  const contracts = await fetchAll<ListContract>((a, b) =>
    ctx.admin.from("rental_contracts").select(LIST_COLS).eq("organization_id", orgId).order("number", { ascending: false }).range(a, b),
  );
  if (!contracts.length) return empty;

  const monthStart = `${monthOf(today).slice(0, 7)}-01`;
  const [props, parties, people, charges, credits, adjs] = await Promise.all([
    fetchAll<PropertyRow>((a, b) => ctx.admin.from("rental_properties").select(PROPERTY_COLS).eq("organization_id", orgId).range(a, b)),
    fetchAll<Pick<RentalContractParty, "contract_id" | "person_id" | "is_primary" | "sort_order">>((a, b) =>
      ctx.admin
        .from("rental_contract_parties")
        .select("contract_id, person_id, is_primary, sort_order")
        .eq("organization_id", orgId)
        .eq("role", "inquilino")
        .range(a, b),
    ),
    fetchAll<{ id: string; full_name: string }>((a, b) =>
      ctx.admin.from("rental_people").select("id, full_name").eq("organization_id", orgId).range(a, b),
    ),
    fetchAll<{ contract_id: string; subtotal: number; paid_amount: number; due_date: string }>((a, b) =>
      ctx.admin
        .from("rental_charges")
        .select("contract_id, subtotal, paid_amount, due_date")
        .eq("organization_id", orgId)
        .is("voided_at", null)
        .in("status", ["pendiente", "parcial"])
        .range(a, b),
    ),
    fetchAll<{ contract_id: string; unallocated_amount: number }>((a, b) =>
      ctx.admin
        .from("rental_payments")
        .select("contract_id, unallocated_amount")
        .eq("organization_id", orgId)
        .is("voided_at", null)
        .gt("unallocated_amount", 0)
        .range(a, b),
    ),
    fetchAll<AdjustmentRow & { contract_id: string }>((a, b) =>
      ctx.admin.from("rental_adjustments").select(ADJ_COLS).eq("organization_id", orgId).gte("effective_date", monthStart).range(a, b),
    ),
  ]);

  const propMap = new Map(props.map((p) => [p.id, p]));
  const personName = new Map(people.map((p) => [p.id, p.full_name]));
  const tenantsBy = new Map<string, typeof parties>();
  for (const p of parties) tenantsBy.set(p.contract_id, [...(tenantsBy.get(p.contract_id) ?? []), p]);
  const debtBy = new Map<string, { debt: number; overdue: number }>();
  for (const ch of charges) {
    const out = Math.max(0, Number(ch.subtotal) - Number(ch.paid_amount));
    if (out <= 0.004) continue;
    const d = debtBy.get(ch.contract_id) ?? { debt: 0, overdue: 0 };
    d.debt += out;
    if (ch.due_date < today) d.overdue += out;
    debtBy.set(ch.contract_id, d);
  }
  const creditBy = new Map<string, number>();
  for (const p of credits) creditBy.set(p.contract_id, (creditBy.get(p.contract_id) ?? 0) + Number(p.unallocated_amount));
  const adjBy = new Map<string, AdjustmentRow[]>();
  for (const a of adjs) adjBy.set(a.contract_id, [...(adjBy.get(a.contract_id) ?? []), a]);

  const rows: ContractListRow[] = contracts.map((c) => {
    const prop = propMap.get(c.property_id);
    const tenants = (tenantsBy.get(c.id) ?? []).sort((x, y) => Number(y.is_primary) - Number(x.is_primary) || x.sort_order - y.sort_order);
    const primary = tenants[0] ?? null;
    const live = c.status === "vigente";
    const plan = buildContractPlan(c);
    const period = c.status === "borrador" || live ? periodAt(plan.schedule, today) : null;
    const merged = live ? mergeAdjustments(plan.chain, adjBy.get(c.id) ?? [], today) : [];
    const next = merged.find((a) => a.effectiveDate > today && a.status !== "omitido") ?? null;
    const debt = debtBy.get(c.id);
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      displayState: contractDisplayState(c, today),
      propertyId: c.property_id,
      propertyCode: prop?.code ?? "—",
      address: prop ? propertyAddress(prop) : "Propiedad",
      city: prop?.city ?? "",
      tenantId: primary?.person_id ?? null,
      tenantName: primary ? (personName.get(primary.person_id) ?? null) : null,
      extraTenants: Math.max(0, tenants.length - 1),
      startDate: c.start_date,
      endDate: c.end_date,
      daysToEnd: diffDays(today, c.end_date),
      terminatedAt: c.terminated_at,
      currency: c.currency,
      currentRent: Number(live ? c.current_rent : c.status === "borrador" ? c.initial_rent : c.current_rent),
      periodIndex: period?.index ?? null,
      periodLabel: period ? cyclePositionLabel(period.indexInCycle, period.cycleLength) : null,
      durationMonths: c.duration_months,
      methodLabel: adjustmentSummary(c),
      nextAdjustment: next
        ? { date: next.effectiveDate, days: diffDays(today, next.effectiveDate), status: next.status, amount: next.amount, variationPct: next.variationPct }
        : null,
      adjustsThisMonth: merged.some((a) => monthOf(a.effectiveDate) === monthOf(today) && a.status !== "omitido"),
      debt: Math.round((debt?.debt ?? 0) * 100) / 100,
      overdue: Math.round((debt?.overdue ?? 0) * 100) / 100,
      credit: Math.round((creditBy.get(c.id) ?? 0) * 100) / 100,
    };
  });

  const counts = { ...empty.counts };
  for (const r of rows) for (const v of viewOfRow(r)) counts[v] += 1;
  return { rows, counts, total: rows.length };
}

// ─── Ficha ──────────────────────────────────────────────────────────────────

export async function loadContractDetail(ctx: RentalsCtx, contractId: string): Promise<ContractDetailData | null> {
  const orgId = ctx.organization.id;
  const today = ctx.today;
  const { data } = await ctx.admin.from("rental_contracts").select("*").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return null;

  const [propRes, ownerLinks, partyRes, adjRes, chargeRes, payRes, renewalRes, fromRes, series, settings] = await Promise.all([
    ctx.admin.from("rental_properties").select(PROPERTY_COLS).eq("id", contract.property_id).eq("organization_id", orgId).maybeSingle(),
    ctx.admin.from("rental_property_owners").select("owner_id, ownership_pct, is_primary").eq("property_id", contract.property_id).eq("organization_id", orgId),
    ctx.admin.from("rental_contract_parties").select("*").eq("contract_id", contractId).eq("organization_id", orgId).order("sort_order"),
    ctx.admin.from("rental_adjustments").select(ADJ_COLS).eq("contract_id", contractId).eq("organization_id", orgId).order("sequence"),
    ctx.admin
      .from("rental_charges")
      .select("id, label, due_date, subtotal, paid_amount, status")
      .eq("contract_id", contractId)
      .eq("organization_id", orgId)
      .is("voided_at", null)
      .order("due_date"),
    ctx.admin.from("rental_payments").select("id, unallocated_amount").eq("contract_id", contractId).eq("organization_id", orgId).is("voided_at", null),
    ctx.admin
      .from("rental_contracts")
      .select("id, number, status")
      .eq("organization_id", orgId)
      .eq("renewed_from_id", contractId)
      .order("created_at", { ascending: false })
      .limit(1),
    contract.renewed_from_id
      ? ctx.admin.from("rental_contracts").select("id, number").eq("id", contract.renewed_from_id).eq("organization_id", orgId).maybeSingle()
      : Promise.resolve({ data: null }),
    loadSeriesForContract(ctx.admin, contract).catch(() => null),
    getRentalSettings(ctx.admin, orgId),
  ]);

  const prop = propRes.data as PropertyRow | null;
  const links = (ownerLinks.data ?? []) as Pick<RentalPropertyOwner, "owner_id" | "ownership_pct" | "is_primary">[];
  const partyRows = (partyRes.data ?? []) as RentalContractParty[];
  const [ownerInfo, peopleRes] = await Promise.all([
    loadOwnerNames(ctx.admin, orgId, links.map((l) => l.owner_id)),
    partyRows.length
      ? ctx.admin
          .from("rental_people")
          .select("id, full_name, doc_type, doc_number, tax_id, phone, email")
          .eq("organization_id", orgId)
          .in("id", [...new Set(partyRows.map((p) => p.person_id))])
      : Promise.resolve({ data: [] }),
  ]);
  const people = new Map(((peopleRes.data ?? []) as RentalPerson[]).map((p) => [p.id, p]));

  const rows = (adjRes.data ?? []) as AdjustmentRow[];
  const plan = buildContractPlan(contract, {
    series,
    applied: appliedMapOf(rows as Pick<RentalAdjustment, "sequence" | "status" | "applied_amount">[]),
    skipped: skippedSetOf(rows as Pick<RentalAdjustment, "sequence" | "status">[]),
  });
  const adjustments = mergeAdjustments(plan.chain, rows, today);
  const live = contract.status === "vigente";
  const rentInForce = live
    ? (rentInForceOn(plan, Number(contract.initial_rent), today) ?? Number(contract.current_rent))
    : contract.status === "borrador"
      ? Number(contract.initial_rent)
      : Number(contract.current_rent);

  const charges = (chargeRes.data ?? []) as { id: string; label: string; due_date: string; subtotal: number; paid_amount: number; status: string }[];
  let debt = 0;
  let overdue = 0;
  let openCharges = 0;
  let oldestOverdueDue: string | null = null;
  let nextDue: ContractDetailData["balance"]["nextDue"] = null;
  for (const ch of charges) {
    const out = Math.round((Number(ch.subtotal) - Number(ch.paid_amount)) * 100) / 100;
    if (ch.status === "pagado" || ch.status === "anulado" || out <= 0.004) continue;
    openCharges += 1;
    debt += out;
    if (ch.due_date < today) {
      overdue += out;
      if (!oldestOverdueDue || ch.due_date < oldestOverdueDue) oldestOverdueDue = ch.due_date;
    } else if (!nextDue) {
      nextDue = { id: ch.id, label: ch.label, dueDate: ch.due_date, outstanding: out };
    }
  }
  const payments = (payRes.data ?? []) as { id: string; unallocated_amount: number }[];
  const credit = payments.reduce((s, p) => s + Number(p.unallocated_amount || 0), 0);

  const entrySuggestion =
    contract.status === "borrador"
      ? computeEntryBreakdown({
          currency: contract.currency,
          monthlyRent: Number(contract.initial_rent),
          durationMonths: contract.duration_months,
          contractValue: stipulatedContractValue(contract),
          deposit: Number(contract.deposit_amount),
          depositCurrency: contract.deposit_currency,
          tenantCommission: contract.tenant_commission,
          ownerCommission: contract.owner_commission,
          stamp: {
            status: contract.stamp_tax_status,
            manualAmount: contract.stamp_tax_amount != null ? Number(contract.stamp_tax_amount) : null,
            ratePct: Number(settings.stamp_tax_rate_pct),
            exemptMonthly: settings.stamp_tax_exempt_monthly != null ? Number(settings.stamp_tax_exempt_monthly) : STAMP_EXEMPT_FALLBACK_2026,
            tenantSharePct: Number(settings.stamp_tax_tenant_share_pct),
          },
        }).chargeItems
      : [];

  const renewal = ((renewalRes.data ?? []) as { id: string; number: number; status: RentalContract["status"] }[])[0] ?? null;
  const from = (fromRes.data ?? null) as { id: string; number: number } | null;
  return {
    // El hash del token no sale del servidor (la ficha viaja entera al cliente).
    contract: { ...contract, portal_token_hash: null },
    displayState: contractDisplayState(contract, today),
    today,
    property: prop
      ? { id: prop.id, code: prop.code, address: propertyAddress(prop), city: prop.city, propertyType: prop.property_type }
      : { id: contract.property_id, code: "—", address: "Propiedad", city: "", propertyType: "otro" },
    owners: links
      .map((l) => {
        const o = ownerInfo.get(l.owner_id);
        return { ownerId: l.owner_id, name: o?.name ?? "Propietario", pct: Number(l.ownership_pct), isPrimary: l.is_primary, phone: o?.phone ?? null, email: o?.email ?? null };
      })
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.pct - a.pct),
    parties: partyRows.map((p) => {
      const person = people.get(p.person_id);
      const detail = p.guarantee_details ? Object.values(p.guarantee_details).filter((v) => v != null && v !== "").join(" · ") : "";
      return {
        personId: p.person_id,
        role: p.role,
        isPrimary: p.is_primary,
        name: person?.full_name ?? "Persona",
        docLabel: person ? docLabelOf(person) : null,
        phone: person?.phone ?? null,
        email: person?.email ?? null,
        guaranteeType: p.guarantee_type,
        guaranteeDetail: detail || null,
        consentAt: p.guarantor_consent_at,
      };
    }),
    schedule: plan.schedule,
    adjustments,
    rentInForce,
    nextAdjustment: adjustments.find((a) => a.effectiveDate > today && a.status !== "omitido") ?? null,
    balance: {
      currency: contract.currency,
      debt: Math.round(debt * 100) / 100,
      overdue: Math.round(overdue * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      openCharges,
      oldestOverdueDue,
      nextDue,
      hasPayments: payments.length > 0,
    },
    portalPath: contract.status !== "borrador" && contract.portal_enabled ? portalPathOf(contract) : null,
    entrySuggestion,
    renewedFrom: from,
    renewal,
  };
}

// ─── Vista previa del alta ──────────────────────────────────────────────────

export async function buildPlanPreview(ctx: RentalsCtx, input: PlanPreviewInput): Promise<PlanPreview> {
  const today = ctx.today;
  const endDate = contractEndDate(input.start_date, input.duration_months);
  const pc: PlanContract = {
    start_date: input.start_date,
    duration_months: input.duration_months,
    initial_rent: input.initial_rent,
    adjustment_method: input.adjustment_method,
    index_code: input.index_code,
    adjustment_every_months: input.adjustment_every_months,
    index_lag_months: input.index_lag_months,
    fixed_pct: input.fixed_pct,
    steps: input.steps,
    rounding: input.rounding,
    cap_pct: input.cap_pct,
    allow_decrease: input.allow_decrease,
    payment_window_days: input.payment_window_days,
  };
  const [series, settings] = await Promise.all([
    loadSeriesForContract(ctx.admin, { ...pc, end_date: endDate }).catch(() => null),
    getRentalSettings(ctx.admin, ctx.organization.id),
  ]);
  const applied = new Map(input.overrides.map((o) => [o.sequence, o.amount]));
  const plan = buildContractPlan(pc, { series, applied });
  const adjustments = mergeAdjustments(plan.chain, null, today).map((a) =>
    applied.has(a.sequence) ? { ...a, overridden: true, overrideReason: "Monto real cargado a mano" } : a,
  );
  const started = input.start_date <= today;
  const period = started ? periodAt(plan.schedule, today) : null;
  const code = input.adjustment_method === "indice" && input.index_code && isIndexCode(input.index_code) ? input.index_code : null;
  const meta = code ? INDEX_META[code] : null;
  const firstWindow = plan.windows[0];
  const every = input.adjustment_every_months;

  return {
    endDate,
    schedule: plan.schedule,
    adjustments,
    started,
    rentToday: period ? rentForPeriod(input.initial_rent, plan.chain, period.index).amount : null,
    todayPeriodIndex: period?.index ?? null,
    waitingIndex: adjustments.some((a) => a.effectiveDate <= today && (a.status === "pendiente_indice" || a.status === "pendiente_manual")),
    nextAdjustment: adjustments.find((a) => a.effectiveDate > today) ?? null,
    projectedTotal: projectedContractTotal(plan, input.initial_rent),
    entry: computeEntryBreakdown({
      currency: input.currency,
      monthlyRent: input.initial_rent,
      durationMonths: input.duration_months,
      // Lo que dice el contrato, sin los índices ni los montos reales de `plan`.
      contractValue: stipulatedContractValue(pc),
      deposit: input.deposit_amount,
      depositCurrency: input.deposit_currency,
      tenantCommission: input.tenant_commission,
      ownerCommission: input.owner_commission,
      stamp: {
        status: input.stamp_tax_status,
        manualAmount: input.stamp_tax_amount,
        ratePct: Number(settings.stamp_tax_rate_pct),
        exemptMonthly: settings.stamp_tax_exempt_monthly != null ? Number(settings.stamp_tax_exempt_monthly) : STAMP_EXEMPT_FALLBACK_2026,
        tenantSharePct: Number(settings.stamp_tax_tenant_share_pct),
      },
    }),
    index:
      code && meta
        ? { code, label: meta.label, name: meta.name, publisher: meta.publisher, frequency: meta.frequency, lastKey: series?.lastDate ?? null }
        : null,
    lagExample:
      meta && meta.frequency === "monthly" && every
        ? lagExample({
            effectiveMonth: firstWindow ? Number(firstWindow.effectiveDate.slice(5, 7)) : 6,
            every,
            lag: input.index_lag_months,
            indexLabel: meta.label,
          })
        : null,
  };
}

// ─── Historial ──────────────────────────────────────────────────────────────

export interface ContractEventRow {
  id: string;
  event_type: string;
  summary: string;
  actor_name: string | null;
  created_at: string;
}

export async function loadContractEvents(ctx: RentalsCtx, contractId: string): Promise<ContractEventRow[]> {
  const { data } = await ctx.admin
    .from("rental_events")
    .select("id, event_type, summary, actor_name, created_at")
    .eq("organization_id", ctx.organization.id)
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false })
    .limit(300);
  return (data ?? []) as ContractEventRow[];
}

// ─── Intimación (art. 1222) ─────────────────────────────────────────────────

export async function loadIntimationData(
  ctx: RentalsCtx,
  contractId: string,
): Promise<{ ok: true; data: IntimationData } | { ok: false; error: string }> {
  const orgId = ctx.organization.id;
  const { data } = await ctx.admin
    .from("rental_contracts")
    .select("id, number, status, property_id, start_date, signed_at, currency, late_fee_type, late_fee_value")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const c = data as Pick<
    RentalContract,
    "id" | "number" | "status" | "property_id" | "start_date" | "signed_at" | "currency" | "late_fee_type" | "late_fee_value"
  > | null;
  if (!c) return { ok: false, error: "No encontramos el contrato." };
  if (c.status === "borrador") return { ok: false, error: "El contrato todavía es un borrador: no tiene deuda." };
  const [propRes, partyRes, chargeRes, settings] = await Promise.all([
    ctx.admin.from("rental_properties").select(`${PROPERTY_COLS}, province`).eq("id", c.property_id).eq("organization_id", orgId).maybeSingle(),
    ctx.admin.from("rental_contract_parties").select("person_id, role, is_primary, sort_order").eq("contract_id", contractId).eq("organization_id", orgId).order("sort_order"),
    ctx.admin
      .from("rental_charges")
      .select("label, due_date, subtotal, paid_amount, status")
      .eq("contract_id", contractId)
      .eq("organization_id", orgId)
      .is("voided_at", null)
      .in("status", ["pendiente", "parcial"])
      .lt("due_date", ctx.today)
      .order("due_date"),
    getRentalSettings(ctx.admin, orgId),
  ]);
  const lines = ((chargeRes.data ?? []) as { label: string; due_date: string; subtotal: number; paid_amount: number }[])
    .map((ch) => ({ label: ch.label, dueDate: ch.due_date, amount: Math.round((Number(ch.subtotal) - Number(ch.paid_amount)) * 100) / 100 }))
    .filter((l) => l.amount > 0.004);
  if (!lines.length) return { ok: false, error: "El inquilino no tiene cargos vencidos: no hay nada que intimar." };
  const parties = (partyRes.data ?? []) as Pick<RentalContractParty, "person_id" | "role" | "is_primary" | "sort_order">[];
  const { data: peopleData } = await ctx.admin
    .from("rental_people")
    .select("id, full_name, doc_type, doc_number, tax_id")
    .eq("organization_id", orgId)
    .in("id", parties.length ? [...new Set(parties.map((p) => p.person_id))] : ["00000000-0000-0000-0000-000000000000"]);
  const people = new Map(((peopleData ?? []) as RentalPerson[]).map((p) => [p.id, p]));
  const tenants = parties.filter((p) => p.role === "inquilino").sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const tenant = tenants[0] ? people.get(tenants[0].person_id) : null;
  const prop = propRes.data as (PropertyRow & { province: string | null }) | null;
  const address = prop ? `${propertyAddress(prop)}, ${prop.city}${prop.province ? `, ${prop.province}` : ""}` : "el inmueble alquilado";
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const org = ctx.organization;
  const place = [org.legal_name || org.name, org.address, settings.payment_instructions?.trim() || null, org.contact_phone ? `Tel. ${org.contact_phone}` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    ok: true,
    data: {
      today: ctx.today,
      city: prop?.city ?? "",
      tenantName: tenant?.full_name ?? "el inquilino",
      tenantDoc: tenant ? docLabelOf(tenant) : null,
      propertyAddress: address,
      contractNumber: formatContractNumber(c.number),
      contractDate: c.signed_at ?? c.start_date,
      currency: c.currency,
      lines,
      total,
      totalWords: amountToSpanishWords(total, c.currency),
      paymentPlace: place || "en nuestras oficinas",
      guarantors: parties
        .filter((p) => p.role === "garante")
        .map((p) => people.get(p.person_id)?.full_name)
        .filter((n): n is string => Boolean(n)),
      signer: [settings.broker_name, settings.broker_license ? `Mat. ${settings.broker_license}` : null, org.legal_name || org.name].filter(Boolean).join(" · "),
      // Misma regla que la cobranza (hasLateFeesOf): sin tipo o con tasa 0 no hay punitorio pactado.
      lateFee:
        c.late_fee_type === "ninguno" || !(Number(c.late_fee_value) > 0)
          ? null
          : { type: c.late_fee_type, value: Number(c.late_fee_value) },
    },
  };
}

// ─── Edición ────────────────────────────────────────────────────────────────

export interface ContractForEdit {
  contract: RentalContract;
  parties: Pick<RentalContractParty, "person_id" | "role" | "is_primary" | "guarantee_type" | "guarantee_details" | "guarantor_consent_at">[];
  overrides: { sequence: number; amount: number; reason: string | null }[];
  hasPayments: boolean;
}

export async function loadContractForEdit(ctx: RentalsCtx, contractId: string): Promise<ContractForEdit | null> {
  const orgId = ctx.organization.id;
  const { data } = await ctx.admin.from("rental_contracts").select("*").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
  const contract = data as RentalContract | null;
  if (!contract) return null;
  const [partiesRes, adjRes, payRes] = await Promise.all([
    ctx.admin
      .from("rental_contract_parties")
      .select("person_id, role, is_primary, guarantee_type, guarantee_details, guarantor_consent_at, sort_order")
      .eq("contract_id", contractId)
      .eq("organization_id", orgId)
      .order("sort_order"),
    contract.status === "borrador"
      ? ctx.admin
          .from("rental_adjustments")
          .select("sequence, applied_amount, override_reason")
          .eq("contract_id", contractId)
          .eq("organization_id", orgId)
          .eq("status", "aplicado")
      : Promise.resolve({ data: [] }),
    ctx.admin.from("rental_payments").select("id", { count: "exact", head: true }).eq("contract_id", contractId).eq("organization_id", orgId).is("voided_at", null),
  ]);
  return {
    contract,
    parties: (partiesRes.data ?? []) as ContractForEdit["parties"],
    overrides: ((adjRes.data ?? []) as { sequence: number; applied_amount: number | null; override_reason: string | null }[])
      .filter((a) => a.applied_amount != null)
      .map((a) => ({ sequence: a.sequence, amount: Number(a.applied_amount), reason: a.override_reason })),
    hasPayments: (payRes.count ?? 0) > 0,
  };
}
