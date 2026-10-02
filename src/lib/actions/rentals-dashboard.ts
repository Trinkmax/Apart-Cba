"use server";

import type { RentalProperty } from "@/lib/types/database";
import { propertyAddress } from "@/lib/rentals/labels";
import { isIndexCode, type IndexCode } from "@/lib/rentals/indices";
import { addDays, addMonthsToMonth, diffDays, monthOf } from "@/lib/rentals/ymd";
import { logRentalsError, rentalsContext, type ActionResult, type RentalsCtx } from "@/lib/rentals/server/access";
import { loadIndexPoints } from "@/lib/rentals/server/series";
import { buildAgenda, type AgendaContract } from "@/components/rentals/dashboard/agenda";
import { summarizeIndex, summaryRange } from "@/components/rentals/indices/index-model";
import { firstNameOf } from "@/components/rentals/adjustments/adjustment-text";
import {
  addTo,
  greetingFor,
  type CurrencyAmounts,
  type DashboardKpis,
  type ExpiringContractRow,
  type RentalsDashboardData,
  type UpcomingAdjustmentRow,
} from "@/components/rentals/dashboard/dashboard-types";

/**
 * Resumen del módulo Alquileres: KPIs del mes, agenda "Para hacer hoy",
 * próximos ajustes, vencimientos e índices. Pocas lecturas en paralelo y el
 * cálculo en memoria (una inmobiliaria administra decenas o cientos de
 * contratos, no millones).
 */

type PropertyLite = Pick<RentalProperty, "street" | "street_number" | "floor" | "apartment" | "tower">;

interface ContractRow {
  id: string;
  number: number;
  status: string;
  property_id: string;
  end_date: string;
  currency: string;
  collector: string;
  admin_fee_pct: number | string;
  insurance_required: boolean;
  insurance_expires_at: string | null;
  deposit_status: string;
  deposit_amount: number | string;
  deposit_currency: string | null;
  terminated_at: string | null;
  adjustment_method: string;
  index_code: string | null;
  property: PropertyLite | null;
  parties: { role: string; is_primary: boolean; person: { full_name: string } | null }[] | null;
}

interface ChargeRow {
  id: string;
  contract_id: string;
  kind: string;
  label: string;
  due_date: string;
  subtotal: number | string;
  paid_amount: number | string;
  currency: string;
  items?: { kind: string; payee: string; amount: number | string; paid_amount: number | string }[] | null;
}

interface AdjustmentRow {
  id: string;
  contract_id: string;
  status: string;
  effective_date: string;
  base_amount: number | string | null;
  computed_amount: number | string | null;
  applied_amount: number | string | null;
  variation_pct: number | string | null;
  index_code: string | null;
  to_key: string | null;
}

const n = (v: number | string | null | undefined): number => (v == null || v === "" ? 0 : Number(v));
const nOrNull = (v: number | string | null | undefined): number | null => (v == null || v === "" ? null : Number(v));

function tenantOf(c: ContractRow): string | null {
  const tenants = (c.parties ?? []).filter((p) => p.role === "inquilino" && p.person);
  return (tenants.find((p) => p.is_primary) ?? tenants[0])?.person?.full_name ?? null;
}

function hourIn(tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date());
    return Number(h) % 24;
  } catch {
    return 12;
  }
}

async function readAll(ctx: RentalsCtx) {
  const org = ctx.organization.id;
  const { today } = ctx;
  const month = monthOf(today);
  const monthEnd = addDays(addMonthsToMonth(month, 1), -1);
  const in60 = addDays(today, 60);
  return Promise.all([
    ctx.admin
      .from("rental_contracts")
      .select(
        `id, number, status, property_id, end_date, currency, collector, admin_fee_pct, insurance_required, insurance_expires_at,
         deposit_status, deposit_amount, deposit_currency, terminated_at, adjustment_method, index_code,
         property:rental_properties(street, street_number, floor, apartment, tower),
         parties:rental_contract_parties(role, is_primary, person:rental_people(full_name))`,
      )
      .eq("organization_id", org)
      .or("status.in.(borrador,vigente),deposit_status.eq.retenido")
      .limit(2000),
    ctx.admin.from("rental_properties").select("id, availability").eq("organization_id", org).eq("active", true).limit(5000),
    ctx.admin
      .from("rental_charges")
      .select("id, contract_id, kind, label, due_date, subtotal, paid_amount, currency, items:rental_charge_items(kind, payee, amount, paid_amount)")
      .eq("organization_id", org)
      .is("voided_at", null)
      .gte("due_date", month)
      .lte("due_date", monthEnd)
      .limit(5000),
    ctx.admin
      .from("rental_charges")
      .select("id, contract_id, kind, label, due_date, subtotal, paid_amount, currency")
      .eq("organization_id", org)
      .is("voided_at", null)
      .in("status", ["pendiente", "parcial"])
      .lt("due_date", today)
      .limit(5000),
    ctx.admin
      .from("rental_adjustments")
      .select("id, contract_id, status, effective_date, base_amount, computed_amount, applied_amount, variation_pct, index_code, to_key")
      .eq("organization_id", org)
      .or(`status.in.(calculado,pendiente_indice,pendiente_manual),and(effective_date.gte.${today},effective_date.lte.${in60})`)
      .limit(2000),
    ctx.admin.from("rental_proofs").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "en_revision"),
    ctx.admin.from("rental_payment_reports").select("id, contract_id, amount, currency, created_at").eq("organization_id", org).eq("status", "pendiente").limit(200),
    ctx.admin
      .from("rental_owner_statements")
      .select("id, number, net_amount, currency, generated_at, owner:owners(full_name)")
      .eq("organization_id", org)
      .eq("status", "emitida")
      .limit(200),
  ]);
}

async function hasAnyContract(ctx: RentalsCtx): Promise<boolean> {
  const { count } = await ctx.admin
    .from("rental_contracts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organization.id);
  return (count ?? 0) > 0;
}

export async function getRentalsDashboard(): Promise<ActionResult<{ data: RentalsDashboardData }>> {
  const r = await rentalsContext("view");
  if (!r.ok) return r;
  const { ctx } = r;
  const { today } = ctx;
  try {
    const [contractsRes, propsRes, monthRes, overdueRes, adjRes, proofsRes, reportsRes, statementsRes] = await readAll(ctx);
    const firstError = [contractsRes, propsRes, monthRes, overdueRes, adjRes, reportsRes, statementsRes].find((x) => x.error)?.error;
    if (firstError) throw new Error(firstError.message);

    const contracts = (contractsRes.data ?? []) as unknown as ContractRow[];
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const vigentes = contracts.filter((c) => c.status === "vigente");
    const mainCurrency = ctx.organization.default_currency || "ARS";

    // ── KPIs del mes ──
    const expected: CurrencyAmounts = {};
    const collected: CurrencyAmounts = {};
    const pending: CurrencyAmounts = {};
    const feesExpected: CurrencyAmounts = {};
    const feesCollected: CurrencyAmounts = {};
    for (const ch of (monthRes.data ?? []) as unknown as ChargeRow[]) {
      const subtotal = n(ch.subtotal);
      const paid = n(ch.paid_amount);
      addTo(expected, ch.currency, subtotal);
      addTo(collected, ch.currency, paid);
      if (ch.due_date >= today) addTo(pending, ch.currency, Math.max(0, subtotal - paid));
      const c = byId.get(ch.contract_id);
      for (const it of ch.items ?? []) {
        // Comisión de la locación (cargo de ingreso): es de la inmobiliaria entera.
        if (it.kind === "honorarios" && it.payee === "inmobiliaria") {
          addTo(feesExpected, ch.currency, n(it.amount));
          addTo(feesCollected, ch.currency, n(it.paid_amount));
        }
        // Administración: % del alquiler que cobra la inmobiliaria para el propietario.
        if (c && c.collector === "inmobiliaria" && it.payee === "propietario" && (it.kind === "alquiler" || it.kind === "diferencia_ajuste")) {
          const pct = n(c.admin_fee_pct) / 100;
          addTo(feesExpected, ch.currency, n(it.amount) * pct);
          addTo(feesCollected, ch.currency, n(it.paid_amount) * pct);
        }
      }
    }
    const overdueRows = (overdueRes.data ?? []) as unknown as ChargeRow[];
    const overdue: CurrencyAmounts = {};
    const overdueContracts = new Set<string>();
    for (const ch of overdueRows) {
      const owed = n(ch.subtotal) - n(ch.paid_amount);
      if (owed <= 0.005) continue;
      addTo(overdue, ch.currency, owed);
      overdueContracts.add(ch.contract_id);
    }
    const props = (propsRes.data ?? []) as { id: string; availability: string }[];
    const rentedIds = new Set(vigentes.map((c) => c.property_id));
    const adjustments = ((adjRes.data ?? []) as unknown as AdjustmentRow[]).filter((a) => byId.get(a.contract_id)?.status === "vigente");
    const in30 = addDays(today, 30);
    const kpis: DashboardKpis = {
      month: monthOf(today),
      expected,
      collected,
      pending,
      overdue,
      overdueContracts: overdueContracts.size,
      activeContracts: vigentes.length,
      draftContracts: contracts.filter((c) => c.status === "borrador").length,
      totalProperties: props.length,
      rentedProperties: props.filter((p) => rentedIds.has(p.id)).length,
      vacantProperties: props.filter((p) => !rentedIds.has(p.id) && p.availability !== "retirada").length,
      feesExpected,
      feesCollected,
      proofsInReview: proofsRes.count ?? 0,
      adjustmentsNext30: adjustments.filter((a) => a.effective_date >= today && a.effective_date <= in30 && a.status !== "omitido").length,
    };

    // ── Agenda ──
    const agendaContracts: AgendaContract[] = contracts.map((c) => ({
      id: c.id,
      number: c.number,
      status: c.status,
      address: c.property ? propertyAddress(c.property) : "Propiedad",
      tenantName: tenantOf(c),
      endDate: c.end_date,
      terminatedAt: c.terminated_at,
      currency: c.currency,
      insuranceRequired: c.insurance_required,
      insuranceExpiresAt: c.insurance_expires_at,
      depositStatus: c.deposit_status,
      depositAmount: n(c.deposit_amount),
      depositCurrency: c.deposit_currency,
    }));
    const agenda = buildAgenda({
      today,
      contracts: agendaContracts,
      overdue: overdueRows.map((ch) => ({
        contractId: ch.contract_id,
        kind: ch.kind,
        label: ch.label,
        dueDate: ch.due_date,
        outstanding: Math.round((n(ch.subtotal) - n(ch.paid_amount)) * 100) / 100,
        currency: ch.currency,
      })),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        contractId: a.contract_id,
        status: a.status,
        effectiveDate: a.effective_date,
        baseAmount: nOrNull(a.base_amount),
        computedAmount: nOrNull(a.computed_amount),
        variationPct: nOrNull(a.variation_pct),
        indexCode: a.index_code,
        toKey: a.to_key,
      })),
      paymentReports: ((reportsRes.data ?? []) as { id: string; contract_id: string; amount: number | string | null; currency: string | null; created_at: string }[]).map((p) => ({
        id: p.id,
        contractId: p.contract_id,
        amount: nOrNull(p.amount),
        currency: p.currency,
        createdAt: p.created_at,
      })),
      proofsInReview: kpis.proofsInReview,
      unpaidStatements: ((statementsRes.data ?? []) as unknown as { id: string; number: number; net_amount: number | string; currency: string; generated_at: string; owner: { full_name: string } | null }[]).map((s) => ({
        id: s.id,
        number: s.number,
        ownerName: s.owner?.full_name ?? "Propietario",
        net: n(s.net_amount),
        currency: s.currency,
        date: s.generated_at?.slice(0, 10) ?? null,
      })),
    });
    const agendaById = new Map(agendaContracts.map((c) => [c.id, c]));
    const addressOf = (id: string) => agendaById.get(id);

    // ── Columna lateral ──
    const upcomingAdjustments: UpcomingAdjustmentRow[] = adjustments
      .filter((a) => a.effective_date >= today && a.effective_date <= addDays(today, 60) && a.status !== "omitido")
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
      .slice(0, 6)
      .map((a) => {
        const c = byId.get(a.contract_id)!;
        return {
          id: a.id,
          contractId: a.contract_id,
          contractNumber: c.number,
          address: addressOf(a.contract_id)?.address ?? "Propiedad",
          tenantName: tenantOf(c),
          effectiveDate: a.effective_date,
          status: a.status,
          baseAmount: nOrNull(a.base_amount),
          newAmount: nOrNull(a.applied_amount) ?? nOrNull(a.computed_amount),
          variationPct: nOrNull(a.variation_pct),
          currency: c.currency,
          indexCode: a.index_code,
          toKey: a.to_key,
        };
      });
    const expiring: ExpiringContractRow[] = vigentes
      .map((c) => ({ c, daysLeft: diffDays(today, c.end_date) }))
      .filter((x) => x.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 6)
      .map(({ c, daysLeft }) => ({
        contractId: c.id,
        contractNumber: c.number,
        address: addressOf(c.id)?.address ?? "Propiedad",
        tenantName: tenantOf(c),
        endDate: c.end_date,
        daysLeft,
      }));

    // ── Índices: IPC e ICL siempre, más los que usan los contratos ──
    const codes = new Set<IndexCode>(["ipc", "icl"]);
    for (const c of contracts) if (c.adjustment_method === "indice" && isIndexCode(c.index_code)) codes.add(c.index_code);
    const indices = await Promise.all(
      [...codes].slice(0, 4).map(async (code) => {
        const [from, to] = summaryRange(code, today);
        return summarizeIndex(code, await loadIndexPoints(ctx.admin, code, from, to), today);
      }),
    );

    return {
      ok: true,
      data: {
        today,
        greeting: greetingFor(hourIn(ctx.tz)),
        firstName: firstNameOf(ctx.session.profile?.full_name),
        mainCurrency,
        hasContracts: contracts.length > 0 || (await hasAnyContract(ctx)),
        kpis,
        agenda,
        upcomingAdjustments,
        expiring,
        indices,
      },
    };
  } catch (e) {
    logRentalsError("getRentalsDashboard", e);
    return { ok: false, error: "No se pudo armar el resumen. Probá de nuevo en un momento." };
  }
}
