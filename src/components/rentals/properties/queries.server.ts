import "server-only";
import type { AdminClient } from "@/lib/rentals/server/access";
import { contractDisplayState } from "@/lib/rentals/labels";
import type { RentalContractStatus, RentalGuaranteeType, RentalPartyRole } from "@/lib/types/database";
import type { ContractPartyView, ContractSummary, PropertyOwnerView } from "./property-types";

/**
 * Lecturas compartidas de Propiedades y Personas (server-only, NO es un
 * archivo "use server": nada de acá es invocable desde el navegador). Todas
 * filtran por organización; el que llama ya pasó por `rentalsContext`.
 */

interface PartyRow {
  person_id: string;
  role: RentalPartyRole;
  is_primary: boolean;
  sort_order: number | null;
  guarantee_type: RentalGuaranteeType | null;
  person: { id: string; full_name: string } | null;
}

interface ContractRow {
  id: string;
  number: number;
  property_id: string;
  status: RentalContractStatus;
  start_date: string;
  end_date: string;
  terminated_at: string | null;
  /** Con fecha = rescisión notificada (no una entrega programada): cambia el estado que se muestra. */
  termination_notice_date: string | null;
  currency: string;
  current_rent: number | string | null;
  rental_contract_parties: PartyRow[] | null;
}

const CONTRACT_SELECT =
  "id, number, property_id, status, start_date, end_date, terminated_at, termination_notice_date, currency, current_rent, " +
  "rental_contract_parties(person_id, role, is_primary, sort_order, guarantee_type, person:rental_people(id, full_name))";

export class RentalsQueryError extends Error {}

function fail(context: string, error: { message?: string } | null): never {
  throw new RentalsQueryError(`${context}: ${error?.message ?? "sin detalle"}`);
}

function partyRank(p: PartyRow): number {
  if (p.role === "inquilino") return p.is_primary ? 0 : 1;
  return 2;
}

/** Deuda abierta por contrato: total pendiente y la parte vencida (vence antes de hoy). */
export async function loadOpenBalances(
  admin: AdminClient,
  orgId: string,
  today: string,
  contractIds?: string[],
): Promise<Map<string, { balance: number; overdue: number }>> {
  const out = new Map<string, { balance: number; overdue: number }>();
  if (contractIds && contractIds.length === 0) return out;
  let q = admin
    .from("rental_charges")
    .select("contract_id, subtotal, paid_amount, due_date")
    .eq("organization_id", orgId)
    .in("status", ["pendiente", "parcial"])
    .is("voided_at", null);
  if (contractIds) q = q.in("contract_id", contractIds);
  const { data, error } = await q;
  if (error) fail("cargos abiertos", error);
  for (const c of (data ?? []) as { contract_id: string; subtotal: number; paid_amount: number; due_date: string }[]) {
    const open = Math.max(0, Number(c.subtotal) - Number(c.paid_amount));
    if (open <= 0.005) continue;
    const acc = out.get(c.contract_id) ?? { balance: 0, overdue: 0 };
    acc.balance += open;
    if (c.due_date < today) acc.overdue += open;
    out.set(c.contract_id, acc);
  }
  for (const v of out.values()) {
    v.balance = Math.round(v.balance * 100) / 100;
    v.overdue = Math.round(v.overdue * 100) / 100;
  }
  return out;
}

/** Contratos con sus partes y su deuda, del más nuevo al más viejo. */
export async function loadContractSummaries(
  admin: AdminClient,
  orgId: string,
  today: string,
  filter: { propertyId?: string; contractIds?: string[]; statuses?: RentalContractStatus[] } = {},
): Promise<ContractSummary[]> {
  if (filter.contractIds && filter.contractIds.length === 0) return [];
  let q = admin.from("rental_contracts").select(CONTRACT_SELECT).eq("organization_id", orgId);
  if (filter.propertyId) q = q.eq("property_id", filter.propertyId);
  if (filter.contractIds) q = q.in("id", filter.contractIds);
  if (filter.statuses) q = q.in("status", filter.statuses);
  const { data, error } = await q.order("start_date", { ascending: false }).limit(1000);
  if (error) fail("contratos", error);
  const rows = (data ?? []) as unknown as ContractRow[];
  // Filtro acotado → sólo los cargos de esos contratos; listado de la org → una sola lectura de todo lo abierto.
  const narrow = Boolean(filter.contractIds || filter.propertyId);
  const balances = await loadOpenBalances(admin, orgId, today, narrow ? rows.map((r) => r.id) : undefined);
  return rows.map((r) => {
    const parties = [...(r.rental_contract_parties ?? [])].sort(
      (a, b) => partyRank(a) - partyRank(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    const views: ContractPartyView[] = parties.map((p) => ({
      person_id: p.person_id,
      full_name: p.person?.full_name ?? "Persona sin nombre",
      role: p.role,
      is_primary: p.is_primary,
      guarantee_type: p.guarantee_type,
    }));
    const tenant = views.find((p) => p.role === "inquilino") ?? null;
    const bal = balances.get(r.id) ?? { balance: 0, overdue: 0 };
    return {
      id: r.id,
      number: r.number,
      property_id: r.property_id,
      status: r.status,
      display_state: contractDisplayState(r, today),
      start_date: r.start_date,
      end_date: r.end_date,
      terminated_at: r.terminated_at,
      currency: r.currency || "ARS",
      current_rent: Number(r.current_rent ?? 0),
      tenant: tenant ? { id: tenant.person_id, full_name: tenant.full_name } : null,
      parties: views,
      balance: bal.balance,
      overdue: bal.overdue,
    };
  });
}

interface OwnerLinkRow {
  property_id: string;
  owner_id: string;
  ownership_pct: number | string;
  is_primary: boolean;
  owner: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    cbu: string | null;
    alias_cbu: string | null;
    bank_name: string | null;
  } | null;
}

/** Titulares por propiedad (principal primero, después por %). */
export async function loadPropertyOwners(
  admin: AdminClient,
  orgId: string,
  propertyId?: string,
): Promise<Map<string, PropertyOwnerView[]>> {
  let q = admin
    .from("rental_property_owners")
    .select("property_id, owner_id, ownership_pct, is_primary, owner:owners(id, full_name, phone, email, cbu, alias_cbu, bank_name)")
    .eq("organization_id", orgId);
  if (propertyId) q = q.eq("property_id", propertyId);
  const { data, error } = await q.limit(5000);
  if (error) fail("propietarios de las propiedades", error);
  const out = new Map<string, PropertyOwnerView[]>();
  for (const r of (data ?? []) as unknown as OwnerLinkRow[]) {
    const list = out.get(r.property_id) ?? [];
    list.push({
      owner_id: r.owner_id,
      full_name: r.owner?.full_name ?? "Propietario",
      phone: r.owner?.phone ?? null,
      email: r.owner?.email ?? null,
      cbu: r.owner?.cbu ?? null,
      alias_cbu: r.owner?.alias_cbu ?? null,
      bank_name: r.owner?.bank_name ?? null,
      ownership_pct: Number(r.ownership_pct),
      is_primary: r.is_primary,
    });
    out.set(r.property_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.ownership_pct - a.ownership_pct);
  }
  return out;
}
