"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import type { OwnerSettlement, SettlementLine } from "@/lib/types/database";

interface PreviewLine {
  line_type: SettlementLine["line_type"];
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
}

/**
 * Genera (o regenera) la liquidación de un owner para un período mes/año.
 * Si ya existe en estado borrador, la sobreescribe. Si está revisada/enviada/pagada, error.
 */
export async function generateSettlement(
  ownerId: string,
  year: number,
  month: number,
  currency: string = "ARS"
): Promise<{ settlement: OwnerSettlement; lines: SettlementLine[] }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "create")) {
    throw new Error("No tenés permisos para generar liquidaciones");
  }
  const admin = createAdminClient();

  // Verificar si ya existe
  const { data: existing } = await admin
    .from("owner_settlements")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("owner_id", ownerId)
    .eq("period_year", year)
    .eq("period_month", month)
    .eq("currency", currency)
    .maybeSingle();

  if (existing && existing.status !== "borrador") {
    throw new Error(`Esta liquidación ya está ${existing.status}; no se puede regenerar`);
  }

  // Buscar units del owner con su % de propiedad y posible commission_pct_override
  const { data: unitOwners } = await admin
    .from("unit_owners")
    .select("unit_id, ownership_pct, commission_pct_override, unit:units(id, code, name, default_commission_pct)")
    .eq("owner_id", ownerId);

  if (!unitOwners || unitOwners.length === 0) {
    throw new Error("El propietario no tiene unidades asignadas");
  }

  const unitIds = unitOwners.map((uo) => uo.unit_id);

  // Periodo
  const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);

  // Bookings relevantes al período:
  //   • Temporarias: las que CIERRAN en el mes (check_out_date dentro del mes).
  //   • Mensuales: las que SE SOLAPAN con el mes (start <= periodEnd && end >= periodStart),
  //     porque se prorratean por días ocupados del mes.
  // Hacemos UN solo query (overlap) y luego filtramos por mode al iterar.
  const { data: bookings } = await admin
    .from("bookings")
    .select("*")
    .in("unit_id", unitIds)
    .eq("currency", currency)
    .in("status", ["check_out", "check_in", "confirmada"])
    .lte("check_in_date", periodEnd)
    .gte("check_out_date", periodStart);

  // Tickets cargables al owner aún no liquidados
  const { data: tickets } = await admin
    .from("maintenance_tickets")
    .select("*")
    .in("unit_id", unitIds)
    .eq("billable_to", "owner")
    .eq("related_owner_id", ownerId)
    .is("charged_to_owner_at", null)
    .not("actual_cost", "is", null);

  // Construir líneas
  const lines: PreviewLine[] = [];
  let gross = 0;
  let totalCommission = 0;
  let totalDeductions = 0;

  const daysInMonth = new Date(year, month, 0).getDate();

  for (const b of bookings ?? []) {
    const uo = unitOwners.find((x) => x.unit_id === b.unit_id);
    const ownerShare = Number(uo?.ownership_pct ?? 100) / 100;
    const commissionPct = uo?.commission_pct_override ??
      (uo?.unit as unknown as { default_commission_pct?: number })?.default_commission_pct ?? 20;
    const unitCode = (uo as unknown as { unit?: { code?: string } })?.unit?.code ?? "—";
    const bookingMode = (b.mode as "temporario" | "mensual" | undefined) ?? "temporario";

    if (bookingMode === "mensual") {
      // ─── Mensual: prorratear renta + expensas por días ocupados del mes ───
      // Solo liquidamos si esta booking se solapa con el período.
      const overlapStart = b.check_in_date > periodStart ? b.check_in_date : periodStart;
      const overlapEnd = b.check_out_date < periodEnd ? b.check_out_date : periodEnd;
      // Días ocupados (date diff inclusivo si el inquilino llega antes del fin del mes)
      const startMs = new Date(overlapStart + "T12:00:00").getTime();
      const endMs = new Date(overlapEnd + "T12:00:00").getTime();
      const occupiedDays = Math.max(0, Math.round((endMs - startMs) / 86_400_000));
      if (occupiedDays === 0) continue;

      const monthlyRent = Number(b.monthly_rent ?? 0);
      const monthlyExpenses = Number(b.monthly_expenses ?? 0);
      if (monthlyRent <= 0) continue;

      const proratedRent = (monthlyRent / daysInMonth) * occupiedDays * ownerShare;
      const proratedExpenses = (monthlyExpenses / daysInMonth) * occupiedDays * ownerShare;
      const commission = proratedRent * (Number(commissionPct) / 100);

      gross += proratedRent;
      totalCommission += commission;

      lines.push({
        line_type: "monthly_rent_fraction",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: `Renta mensual ${overlapStart} → ${overlapEnd} (${occupiedDays}/${daysInMonth} días) — ${unitCode}`,
        amount: proratedRent,
        sign: "+",
      });
      lines.push({
        line_type: "commission",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: `Comisión rentOS ${commissionPct}% (mensual prorrateada)`,
        amount: commission,
        sign: "-",
      });
      if (proratedExpenses > 0) {
        lines.push({
          line_type: "expenses_fraction",
          ref_type: "booking",
          ref_id: b.id,
          unit_id: b.unit_id,
          description: `Expensas prorrateadas (${occupiedDays}/${daysInMonth} días)`,
          amount: proratedExpenses,
          sign: "-",
        });
        totalDeductions += proratedExpenses;
      }
      continue;
    }

    // ─── Temporario: liquida en el mes del check_out (como antes) ───
    if (b.check_out_date < periodStart || b.check_out_date > periodEnd) continue;
    const grossOwner = Number(b.total_amount) * ownerShare;
    const commission = grossOwner * (Number(commissionPct) / 100);

    gross += grossOwner;
    totalCommission += commission;

    lines.push({
      line_type: "booking_revenue",
      ref_type: "booking",
      ref_id: b.id,
      unit_id: b.unit_id,
      description: `Reserva ${b.check_in_date} → ${b.check_out_date} (${unitCode})`,
      amount: grossOwner,
      sign: "+",
    });
    lines.push({
      line_type: "commission",
      ref_type: "booking",
      ref_id: b.id,
      unit_id: b.unit_id,
      description: `Comisión rentOS ${commissionPct}%`,
      amount: commission,
      sign: "-",
    });

    // Cleaning fee descuento
    if (b.cleaning_fee && Number(b.cleaning_fee) > 0) {
      const cleaningCharge = Number(b.cleaning_fee) * ownerShare;
      lines.push({
        line_type: "cleaning_charge",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: "Fee de limpieza",
        amount: cleaningCharge,
        sign: "-",
      });
      totalDeductions += cleaningCharge;
    }
  }

  for (const t of tickets ?? []) {
    const cost = Number(t.actual_cost ?? 0);
    if (cost > 0 && t.cost_currency === currency) {
      lines.push({
        line_type: "maintenance_charge",
        ref_type: "ticket",
        ref_id: t.id,
        unit_id: t.unit_id,
        description: `Mantenimiento: ${t.title}`,
        amount: cost,
        sign: "-",
      });
      totalDeductions += cost;
    }
  }

  const netPayable = gross - totalCommission - totalDeductions;

  // Borrar líneas anteriores si era borrador
  if (existing) {
    await admin.from("settlement_lines").delete().eq("settlement_id", existing.id);
  }

  // Upsert settlement
  const settlementPayload = {
    organization_id: organization.id,
    owner_id: ownerId,
    period_year: year,
    period_month: month,
    currency,
    status: "borrador" as const,
    gross_revenue: gross,
    commission_amount: totalCommission,
    deductions_amount: totalDeductions,
    net_payable: netPayable,
    generated_by: session.userId,
    generated_at: new Date().toISOString(),
  };

  let settlementId: string;
  if (existing) {
    const { error } = await admin
      .from("owner_settlements")
      .update(settlementPayload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    settlementId = existing.id;
  } else {
    const { data, error } = await admin
      .from("owner_settlements")
      .insert(settlementPayload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    settlementId = data.id;
  }

  // Insertar líneas
  if (lines.length > 0) {
    const { error } = await admin.from("settlement_lines").insert(
      lines.map((l, idx) => ({
        settlement_id: settlementId,
        ...l,
        display_order: idx,
      }))
    );
    if (error) throw new Error(error.message);
  }

  // Marcar tickets como cargados al settlement
  if (tickets && tickets.length > 0) {
    await admin
      .from("maintenance_tickets")
      .update({ charged_to_owner_at: new Date().toISOString(), charged_to_settlement_id: settlementId })
      .in("id", tickets.map((t) => t.id));
  }

  // Devolver lo creado
  const { data: settlement } = await admin
    .from("owner_settlements")
    .select("*")
    .eq("id", settlementId)
    .single();
  const { data: linesData } = await admin
    .from("settlement_lines")
    .select("*")
    .eq("settlement_id", settlementId)
    .order("display_order");

  revalidatePath("/dashboard/liquidaciones");
  return {
    settlement: settlement as OwnerSettlement,
    lines: (linesData as SettlementLine[]) ?? [],
  };
}

export async function listSettlements(filters?: { ownerId?: string; year?: number; month?: number }) {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) {
    throw new Error("No tenés permisos para ver liquidaciones");
  }
  const admin = createAdminClient();
  let q = admin
    .from("owner_settlements")
    .select(`*, owner:owners(id, full_name, email, preferred_currency)`)
    .eq("organization_id", organization.id);
  if (filters?.ownerId) q = q.eq("owner_id", filters.ownerId);
  if (filters?.year) q = q.eq("period_year", filters.year);
  if (filters?.month) q = q.eq("period_month", filters.month);
  const { data, error } = await q.order("period_year", { ascending: false }).order("period_month", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSettlement(id: string) {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) {
    throw new Error("No tenés permisos para ver liquidaciones");
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("owner_settlements")
    .select(`*, owner:owners(*), lines:settlement_lines(*, unit:units(id, code, name))`)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function changeSettlementStatus(
  id: string,
  status: "borrador" | "revisada" | "enviada" | "pagada" | "anulada",
  paidMovementId?: string
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para cambiar liquidaciones");
  }
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status };
  if (status === "revisada") {
    update.reviewed_at = new Date().toISOString();
    update.reviewed_by = session.userId;
  }
  if (status === "enviada") update.sent_at = new Date().toISOString();
  if (status === "pagada") {
    update.paid_at = new Date().toISOString();
    if (paidMovementId) update.paid_movement_id = paidMovementId;
  }
  const { error } = await admin
    .from("owner_settlements")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/liquidaciones");
  revalidatePath(`/dashboard/liquidaciones/${id}`);
}
