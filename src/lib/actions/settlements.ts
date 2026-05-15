"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg, getOrganizationBranding } from "./org";
import { requireSession } from "./auth";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/format";
import { EDITABLE_STATUSES, formatPeriod } from "@/lib/settlements/labels";
import type {
  OwnerSettlement,
  SettlementLine,
  SettlementLineMeta,
} from "@/lib/types/database";
import type { StatementInput } from "@/lib/settlements/statement-model";

type Admin = ReturnType<typeof createAdminClient>;

const LINE_TYPES = [
  "booking_revenue",
  "commission",
  "maintenance_charge",
  "cleaning_charge",
  "adjustment",
  "monthly_rent_fraction",
  "expenses_fraction",
] as const;

interface ComputedLine {
  line_type: SettlementLine["line_type"];
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  meta: SettlementLineMeta | null;
}

export interface PeriodGenerationResult {
  owner_id: string;
  owner_name: string;
  ok: boolean;
  net?: number;
  currency?: string;
  lines?: number;
  skipped?: string;
}

class NoUnitsError extends Error {
  constructor() {
    super("NO_UNITS");
    this.name = "NoUnitsError";
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Días entre dos fechas ISO (mediodía para evitar saltos de DST). */
function dayDiff(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00").getTime();
  const b = new Date(toISO + "T12:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Modelo de totales unificado. Vale para líneas auto y ajustes manuales:
 *   • gross   = Σ de líneas con signo '+'
 *   • commission = Σ de líneas line_type='commission' (siempre '-')
 *   • deductions = Σ del resto de líneas con signo '-'
 *   • net     = Σ con signo (── + suma, ── − resta)
 * Con solo líneas auto da idéntico a la lógica anterior; un ajuste '+' sube
 * bruto y neto, un ajuste '-' sube gastos y baja neto.
 */
function computeTotals(
  lines: Array<{ amount: number; sign: "+" | "-"; line_type: SettlementLine["line_type"] }>,
) {
  let gross = 0;
  let commission = 0;
  let deductions = 0;
  let net = 0;
  for (const l of lines) {
    const amt = Number(l.amount) || 0;
    if (l.sign === "+") {
      gross += amt;
      net += amt;
    } else {
      net -= amt;
      if (l.line_type === "commission") commission += amt;
      else deductions += amt;
    }
  }
  return {
    gross_revenue: round2(gross),
    commission_amount: round2(commission),
    deductions_amount: round2(deductions),
    net_payable: round2(net),
  };
}

function revalidateSettlement(id?: string) {
  revalidatePath("/dashboard/liquidaciones");
  revalidatePath("/dashboard/liquidaciones/periodo");
  if (id) revalidatePath(`/dashboard/liquidaciones/${id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Core de cálculo — sin escrituras. Reutilizado por single + lote.
// Snapshotea `meta` sobre la línea de ingreso para reconstruir la planilla
// por unidad sin re-derivar de bookings que pueden cambiar después.
// ════════════════════════════════════════════════════════════════════════════
async function buildSettlementLines(opts: {
  admin: Admin;
  ownerId: string;
  year: number;
  month: number;
  currency: string;
}): Promise<{ lines: ComputedLine[]; ticketIds: string[] }> {
  const { admin, ownerId, year, month, currency } = opts;

  const { data: unitOwners } = await admin
    .from("unit_owners")
    .select(
      "unit_id, ownership_pct, commission_pct_override, unit:units(id, code, name, default_commission_pct)",
    )
    .eq("owner_id", ownerId);

  if (!unitOwners || unitOwners.length === 0) throw new NoUnitsError();

  const unitIds = unitOwners.map((uo) => uo.unit_id);
  const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Temporarias: cierran en el mes. Mensuales: se solapan (prorrateo por días).
  const { data: bookings } = await admin
    .from("bookings")
    .select("*, guest:guests(full_name)")
    .in("unit_id", unitIds)
    .eq("currency", currency)
    .in("status", ["check_out", "check_in", "confirmada"])
    .lte("check_in_date", periodEnd)
    .gte("check_out_date", periodStart);

  const { data: tickets } = await admin
    .from("maintenance_tickets")
    .select("*")
    .in("unit_id", unitIds)
    .eq("billable_to", "owner")
    .eq("related_owner_id", ownerId)
    .is("charged_to_owner_at", null)
    .not("actual_cost", "is", null);

  const lines: ComputedLine[] = [];

  for (const b of bookings ?? []) {
    const uo = unitOwners.find((x) => x.unit_id === b.unit_id);
    const ownerShare = Number(uo?.ownership_pct ?? 100) / 100;
    const unit = uo?.unit as unknown as
      | { code?: string; default_commission_pct?: number }
      | undefined;
    const commissionPct = Number(
      uo?.commission_pct_override ?? unit?.default_commission_pct ?? 20,
    );
    const unitCode = unit?.code ?? "—";
    const guestName =
      (b.guest as unknown as { full_name?: string } | null)?.full_name ?? null;
    const source = (b.source as string | null) ?? null;
    const mode = (b.mode as "temporario" | "mensual" | undefined) ?? "temporario";

    if (mode === "mensual") {
      // ── Mensual: prorratear renta + expensas por días ocupados del mes ──
      const overlapStart = b.check_in_date > periodStart ? b.check_in_date : periodStart;
      const overlapEnd = b.check_out_date < periodEnd ? b.check_out_date : periodEnd;
      const occupiedDays = dayDiff(overlapStart, overlapEnd);
      if (occupiedDays === 0) continue;

      const monthlyRent = Number(b.monthly_rent ?? 0);
      const monthlyExpenses = Number(b.monthly_expenses ?? 0);
      if (monthlyRent <= 0) continue;

      const proratedRent = round2((monthlyRent / daysInMonth) * occupiedDays * ownerShare);
      const proratedExpenses = round2(
        (monthlyExpenses / daysInMonth) * occupiedDays * ownerShare,
      );
      const commission = round2(proratedRent * (commissionPct / 100));

      lines.push({
        line_type: "monthly_rent_fraction",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: `Renta mensual ${overlapStart} → ${overlapEnd} (${occupiedDays}/${daysInMonth} días) — ${unitCode}`,
        amount: proratedRent,
        sign: "+",
        meta: {
          guest_name: guestName,
          nights: occupiedDays,
          check_in: overlapStart,
          check_out: overlapEnd,
          source,
          mode: "mensual",
          commission_pct: commissionPct,
          prorate_days: occupiedDays,
          prorate_of: daysInMonth,
        },
      });
      lines.push({
        line_type: "commission",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: `Comisión ${commissionPct}% (mensual prorrateada)`,
        amount: commission,
        sign: "-",
        meta: null,
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
          meta: null,
        });
      }
      continue;
    }

    // ── Temporario: liquida en el mes del check_out ──
    if (b.check_out_date < periodStart || b.check_out_date > periodEnd) continue;
    const grossOwner = round2(Number(b.total_amount) * ownerShare);
    const commission = round2(grossOwner * (commissionPct / 100));
    const nights = dayDiff(b.check_in_date, b.check_out_date);

    lines.push({
      line_type: "booking_revenue",
      ref_type: "booking",
      ref_id: b.id,
      unit_id: b.unit_id,
      description: `Reserva ${b.check_in_date} → ${b.check_out_date} (${unitCode})`,
      amount: grossOwner,
      sign: "+",
      meta: {
        guest_name: guestName,
        nights,
        check_in: b.check_in_date,
        check_out: b.check_out_date,
        source,
        mode: "temporario",
        commission_pct: commissionPct,
      },
    });
    lines.push({
      line_type: "commission",
      ref_type: "booking",
      ref_id: b.id,
      unit_id: b.unit_id,
      description: `Comisión ${commissionPct}%`,
      amount: commission,
      sign: "-",
      meta: null,
    });

    if (b.cleaning_fee && Number(b.cleaning_fee) > 0) {
      lines.push({
        line_type: "cleaning_charge",
        ref_type: "booking",
        ref_id: b.id,
        unit_id: b.unit_id,
        description: "Fee de limpieza",
        amount: round2(Number(b.cleaning_fee) * ownerShare),
        sign: "-",
        meta: null,
      });
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
        amount: round2(cost),
        sign: "-",
        meta: null,
      });
    }
  }

  return { lines, ticketIds: (tickets ?? []).map((t) => t.id) };
}

// ════════════════════════════════════════════════════════════════════════════
// generateOne — genera/regenera 1 liquidación SIN revalidar (lo hace el caller).
// Preserva las líneas is_manual=true al regenerar.
// ════════════════════════════════════════════════════════════════════════════
async function generateOne(opts: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  year: number;
  month: number;
  currency: string;
  userId: string;
}): Promise<{ settlement: OwnerSettlement; lineCount: number }> {
  const { admin, organizationId, ownerId, year, month, currency, userId } = opts;

  const { data: existing } = await admin
    .from("owner_settlements")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("owner_id", ownerId)
    .eq("period_year", year)
    .eq("period_month", month)
    .eq("currency", currency)
    .maybeSingle();

  if (existing && existing.status !== "borrador") {
    throw new Error(`Esta liquidación ya está ${existing.status}; no se puede regenerar`);
  }

  const { lines: autoLines, ticketIds } = await buildSettlementLines({
    admin,
    ownerId,
    year,
    month,
    currency,
  });

  // Preservar ajustes manuales
  let manualLines: SettlementLine[] = [];
  if (existing) {
    const { data: ml } = await admin
      .from("settlement_lines")
      .select("*")
      .eq("settlement_id", existing.id)
      .eq("is_manual", true);
    manualLines = (ml as SettlementLine[]) ?? [];
    await admin
      .from("settlement_lines")
      .delete()
      .eq("settlement_id", existing.id)
      .eq("is_manual", false);
  }

  const totals = computeTotals([
    ...autoLines.map((l) => ({ amount: l.amount, sign: l.sign, line_type: l.line_type })),
    ...manualLines.map((l) => ({
      amount: Number(l.amount),
      sign: l.sign,
      line_type: l.line_type,
    })),
  ]);

  const payload = {
    organization_id: organizationId,
    owner_id: ownerId,
    period_year: year,
    period_month: month,
    currency,
    status: "borrador" as const,
    ...totals,
    generated_by: userId,
    generated_at: new Date().toISOString(),
  };

  let settlementId: string;
  if (existing) {
    const { error } = await admin
      .from("owner_settlements")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    settlementId = existing.id;
  } else {
    const { data, error } = await admin
      .from("owner_settlements")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    settlementId = data.id as string;
  }

  if (autoLines.length > 0) {
    const { error } = await admin.from("settlement_lines").insert(
      autoLines.map((l, idx) => ({
        settlement_id: settlementId,
        line_type: l.line_type,
        ref_type: l.ref_type,
        ref_id: l.ref_id,
        unit_id: l.unit_id,
        description: l.description,
        amount: l.amount,
        sign: l.sign,
        is_manual: false,
        meta: l.meta,
        display_order: idx,
      })),
    );
    if (error) throw new Error(error.message);
  }

  // Reordenar los ajustes manuales después de las líneas auto
  for (let i = 0; i < manualLines.length; i++) {
    await admin
      .from("settlement_lines")
      .update({ display_order: autoLines.length + i })
      .eq("id", manualLines[i].id);
  }

  if (ticketIds.length > 0) {
    await admin
      .from("maintenance_tickets")
      .update({
        charged_to_owner_at: new Date().toISOString(),
        charged_to_settlement_id: settlementId,
      })
      .in("id", ticketIds);
  }

  const { data: settlement } = await admin
    .from("owner_settlements")
    .select("*")
    .eq("id", settlementId)
    .single();

  return {
    settlement: settlement as OwnerSettlement,
    lineCount: autoLines.length + manualLines.length,
  };
}

/**
 * Genera (o regenera) la liquidación de un owner para un período mes/año.
 * Si está revisada/enviada/pagada, error. Preserva ajustes manuales.
 */
export async function generateSettlement(
  ownerId: string,
  year: number,
  month: number,
  currency: string = "ARS",
): Promise<{ settlement: OwnerSettlement; lines: SettlementLine[] }> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "create")) {
    throw new Error("No tenés permisos para generar liquidaciones");
  }
  const admin = createAdminClient();

  let res: { settlement: OwnerSettlement; lineCount: number };
  try {
    res = await generateOne({
      admin,
      organizationId: organization.id,
      ownerId,
      year,
      month,
      currency,
      userId: session.userId,
    });
  } catch (e) {
    if ((e as Error).message === "NO_UNITS") {
      throw new Error("El propietario no tiene unidades asignadas");
    }
    throw e;
  }

  const { data: linesData } = await admin
    .from("settlement_lines")
    .select("*")
    .eq("settlement_id", res.settlement.id)
    .order("display_order");

  revalidateSettlement(res.settlement.id);
  return {
    settlement: res.settlement,
    lines: (linesData as SettlementLine[]) ?? [],
  };
}

/**
 * Genera/regenera en lote todas las liquidaciones de un período para todos los
 * propietarios activos de la org. No pisa liquidaciones cerradas (las saltea).
 */
export async function generateSettlementsForPeriod(
  year: number,
  month: number,
  currency: string = "ARS",
): Promise<PeriodGenerationResult[]> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "create")) {
    throw new Error("No tenés permisos para generar liquidaciones");
  }
  const admin = createAdminClient();

  const { data: owners } = await admin
    .from("owners")
    .select("id, full_name")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("full_name");

  const results: PeriodGenerationResult[] = [];
  for (const o of owners ?? []) {
    try {
      const r = await generateOne({
        admin,
        organizationId: organization.id,
        ownerId: o.id,
        year,
        month,
        currency,
        userId: session.userId,
      });
      results.push({
        owner_id: o.id,
        owner_name: o.full_name,
        ok: true,
        net: Number(r.settlement.net_payable),
        currency,
        lines: r.lineCount,
      });
    } catch (e) {
      const msg = (e as Error).message;
      results.push({
        owner_id: o.id,
        owner_name: o.full_name,
        ok: false,
        skipped:
          msg === "NO_UNITS"
            ? "Sin unidades asignadas"
            : /ya está/.test(msg)
              ? "Ya cerrada (no se regenera)"
              : msg,
      });
    }
  }

  revalidateSettlement();
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// Edición de líneas (solo en borrador) + ajustes manuales
// ════════════════════════════════════════════════════════════════════════════

async function recomputeSettlementTotals(admin: Admin, settlementId: string) {
  const { data: lines } = await admin
    .from("settlement_lines")
    .select("amount, sign, line_type")
    .eq("settlement_id", settlementId);
  const totals = computeTotals(
    (lines ?? []).map((l) => ({
      amount: Number(l.amount),
      sign: l.sign as "+" | "-",
      line_type: l.line_type as SettlementLine["line_type"],
    })),
  );
  await admin.from("owner_settlements").update(totals).eq("id", settlementId);
  return totals;
}

/** Verifica que la liquidación exista, sea de la org y esté editable (borrador). */
async function loadEditableSettlement(
  admin: Admin,
  organizationId: string,
  settlementId: string,
): Promise<{ id: string; status: string }> {
  const { data: s } = await admin
    .from("owner_settlements")
    .select("id, status")
    .eq("id", settlementId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!s) throw new Error("Liquidación no encontrada");
  if (!EDITABLE_STATUSES.includes(s.status)) {
    throw new Error(
      `La liquidación está ${s.status}: solo se pueden editar líneas en borrador`,
    );
  }
  return s as { id: string; status: string };
}

const lineInputSchema = z.object({
  settlement_id: z.string().uuid(),
  line_type: z.enum(LINE_TYPES),
  description: z.string().min(2, "Describí el ajuste").max(200),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive("El importe debe ser mayor a 0"),
  sign: z.enum(["+", "-"]),
});

export async function addSettlementLine(input: z.input<typeof lineInputSchema>) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = lineInputSchema.parse(input);
  const admin = createAdminClient();
  await loadEditableSettlement(admin, organization.id, v.settlement_id);

  const { data: last } = await admin
    .from("settlement_lines")
    .select("display_order")
    .eq("settlement_id", v.settlement_id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (Number(last?.display_order ?? -1) || 0) + 1;

  const { error } = await admin.from("settlement_lines").insert({
    settlement_id: v.settlement_id,
    line_type: v.line_type,
    ref_type: "manual",
    ref_id: null,
    unit_id: v.unit_id ?? null,
    description: v.description,
    amount: v.amount,
    sign: v.sign,
    is_manual: true,
    meta: null,
    display_order: nextOrder,
  });
  if (error) throw new Error(error.message);

  await recomputeSettlementTotals(admin, v.settlement_id);
  revalidateSettlement(v.settlement_id);
}

const lineUpdateSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(2).max(200).optional(),
  amount: z.coerce.number().positive().optional(),
  sign: z.enum(["+", "-"]).optional(),
  line_type: z.enum(LINE_TYPES).optional(),
  unit_id: z.string().uuid().nullable().optional(),
});

/** Editar una línea (auto o manual). Al editarla queda is_manual=true para
 * que sobreviva una regeneración (override intencional del usuario). */
export async function updateSettlementLine(
  input: z.input<typeof lineUpdateSchema>,
) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = lineUpdateSchema.parse(input);
  const admin = createAdminClient();

  const { data: line } = await admin
    .from("settlement_lines")
    .select("id, settlement_id")
    .eq("id", v.id)
    .maybeSingle();
  if (!line) throw new Error("Línea no encontrada");
  await loadEditableSettlement(admin, organization.id, line.settlement_id);

  const patch: Record<string, unknown> = { is_manual: true };
  if (v.description !== undefined) patch.description = v.description;
  if (v.amount !== undefined) patch.amount = v.amount;
  if (v.sign !== undefined) patch.sign = v.sign;
  if (v.line_type !== undefined) patch.line_type = v.line_type;
  if (v.unit_id !== undefined) patch.unit_id = v.unit_id;

  const { error } = await admin
    .from("settlement_lines")
    .update(patch)
    .eq("id", v.id);
  if (error) throw new Error(error.message);

  await recomputeSettlementTotals(admin, line.settlement_id);
  revalidateSettlement(line.settlement_id);
}

export async function deleteSettlementLine(lineId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const id = z.string().uuid().parse(lineId);
  const admin = createAdminClient();

  const { data: line } = await admin
    .from("settlement_lines")
    .select("id, settlement_id")
    .eq("id", id)
    .maybeSingle();
  if (!line) throw new Error("Línea no encontrada");
  await loadEditableSettlement(admin, organization.id, line.settlement_id);

  const { error } = await admin.from("settlement_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await recomputeSettlementTotals(admin, line.settlement_id);
  revalidateSettlement(line.settlement_id);
}

// ════════════════════════════════════════════════════════════════════════════
// Lecturas
// ════════════════════════════════════════════════════════════════════════════

export async function listSettlements(filters?: {
  ownerId?: string;
  year?: number;
  month?: number;
}) {
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
  const { data, error } = await q
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false });
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
    .select(
      `*, owner:owners(*), lines:settlement_lines(*, unit:units(id, code, name))`,
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Lectura PÚBLICA por token aleatorio — para /liquidacion/[token].
 * No usa sesión/cookie de org: el token (uuid, 122 bits) ES el secreto.
 * Expone solo campos de presentación del propietario y branding de la org.
 */
export async function getSettlementByToken(token: string) {
  const parsed = z.string().uuid().safeParse(token);
  if (!parsed.success) return null;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("owner_settlements")
    .select(
      `id, organization_id, owner_id, period_year, period_month, status, currency,
       gross_revenue, commission_amount, deductions_amount, net_payable,
       generated_at, sent_at, paid_at, public_token,
       owner:owners(id, full_name, bank_name, cbu, alias_cbu, preferred_currency),
       lines:settlement_lines(*, unit:units(id, code, name))`,
    )
    .eq("public_token", parsed.data)
    .maybeSingle();
  if (error || !data) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("name, legal_name, tax_id, logo_url, primary_color")
    .eq("id", data.organization_id)
    .maybeSingle();

  return { settlement: data, org: org ?? null };
}

/**
 * Para el panel de período (lote): todos los propietarios activos de la org
 * con su cantidad de unidades y la liquidación de ese período (si existe).
 */
export async function listOwnersForPeriod(
  year: number,
  month: number,
  currency: string = "ARS",
) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) {
    throw new Error("No tenés permisos para ver liquidaciones");
  }
  const admin = createAdminClient();

  const { data: units } = await admin
    .from("units")
    .select("id")
    .eq("organization_id", organization.id);
  const unitIds = (units ?? []).map((u) => u.id);

  const [{ data: owners }, { data: settles }, { data: uo }] = await Promise.all([
    admin
      .from("owners")
      .select("id, full_name, email, cbu, alias_cbu, preferred_currency")
      .eq("organization_id", organization.id)
      .eq("active", true)
      .order("full_name"),
    admin
      .from("owner_settlements")
      .select("id, owner_id, status, net_payable, currency, generated_at")
      .eq("organization_id", organization.id)
      .eq("period_year", year)
      .eq("period_month", month)
      .eq("currency", currency),
    unitIds.length
      ? admin.from("unit_owners").select("owner_id, unit_id").in("unit_id", unitIds)
      : Promise.resolve({ data: [] as Array<{ owner_id: string; unit_id: string }> }),
  ]);

  const unitCount = new Map<string, number>();
  for (const r of uo ?? [])
    unitCount.set(r.owner_id, (unitCount.get(r.owner_id) ?? 0) + 1);
  const byOwner = new Map((settles ?? []).map((s) => [s.owner_id, s]));

  return (owners ?? []).map((o) => ({
    owner: o,
    units: unitCount.get(o.id) ?? 0,
    settlement: byOwner.get(o.id) ?? null,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// Transiciones de estado (revisada / enviada / anulada / disputada).
// El pago (→ pagada) va por registerSettlementPayment (impacta Caja).
// ════════════════════════════════════════════════════════════════════════════
export async function changeSettlementStatus(
  id: string,
  status: "borrador" | "revisada" | "enviada" | "pagada" | "anulada" | "disputada",
  paidMovementId?: string,
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
  revalidateSettlement(id);
}

// ════════════════════════════════════════════════════════════════════════════
// Pago → impacta Caja. Crea un egreso owner_settlement y linkea
// paid_movement_id (mismo patrón que cash.ts; el settlement_lock del 007
// luego protege ese movimiento de ediciones mientras esté pagada).
// ════════════════════════════════════════════════════════════════════════════
const registerPaymentSchema = z.object({
  settlement_id: z.string().uuid(),
  account_id: z.string().uuid(),
  amount: z.coerce.number().positive().optional(),
  paid_at: z.string().optional(),
  notes: z.string().max(300).optional().nullable(),
});

export async function registerSettlementPayment(
  input: z.input<typeof registerPaymentSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para registrar pagos de liquidación");
  }
  const v = registerPaymentSchema.parse(input);
  const admin = createAdminClient();

  const { data: settlement } = await admin
    .from("owner_settlements")
    .select(
      "id, owner_id, period_year, period_month, status, currency, net_payable, paid_movement_id",
    )
    .eq("id", v.settlement_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!settlement) throw new Error("Liquidación no encontrada");
  if (settlement.paid_movement_id || settlement.status === "pagada") {
    throw new Error("Esta liquidación ya tiene un pago registrado");
  }
  if (!["revisada", "enviada"].includes(settlement.status)) {
    throw new Error(
      'Marcá la liquidación como "revisada" o "enviada" antes de registrar el pago',
    );
  }

  const { data: account } = await admin
    .from("cash_accounts")
    .select("id, currency, active, name")
    .eq("id", v.account_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!account) throw new Error("Cuenta de caja no encontrada");
  if (!account.active) throw new Error("La cuenta de caja está inactiva");
  if (account.currency !== settlement.currency) {
    throw new Error(
      `Moneda incompatible: la cuenta es ${account.currency} y la liquidación ${settlement.currency}`,
    );
  }

  const amount = v.amount ?? Number(settlement.net_payable);
  if (!(amount > 0)) {
    throw new Error(
      "El neto a transferir no es positivo: no se puede registrar el pago",
    );
  }
  const occurredAt = v.paid_at ?? new Date().toISOString();
  const periodLabel = formatPeriod(
    settlement.period_year,
    settlement.period_month,
  );

  // 1) Egreso en Caja
  const { data: movement, error: movErr } = await admin
    .from("cash_movements")
    .insert({
      organization_id: organization.id,
      account_id: v.account_id,
      direction: "out",
      amount,
      currency: settlement.currency,
      category: "owner_settlement",
      ref_type: null,
      ref_id: null,
      owner_id: settlement.owner_id,
      billable_to: "owner",
      description: v.notes?.trim()
        ? v.notes.trim()
        : `Pago liquidación ${periodLabel}`,
      occurred_at: occurredAt,
      created_by: session.userId,
    })
    .select()
    .single();
  if (movErr) {
    throw new Error(
      `No se pudo registrar el movimiento de caja: ${movErr.message}`,
    );
  }

  // 2) Cerrar la liquidación + linkear el movimiento
  const { error: updErr } = await admin
    .from("owner_settlements")
    .update({
      status: "pagada",
      paid_at: occurredAt,
      paid_movement_id: movement.id,
    })
    .eq("id", v.settlement_id)
    .eq("organization_id", organization.id);
  if (updErr) {
    // Compensación: que el movimiento no quede huérfano
    await admin.from("cash_movements").delete().eq("id", movement.id);
    throw new Error(`No se pudo cerrar la liquidación: ${updErr.message}`);
  }

  for (const p of [
    "/dashboard/liquidaciones",
    "/dashboard/liquidaciones/periodo",
    `/dashboard/liquidaciones/${v.settlement_id}`,
    "/dashboard/caja",
    `/dashboard/caja/${v.account_id}`,
    "/dashboard/alertas",
    "/dashboard",
  ]) {
    revalidatePath(p);
  }

  return { ok: true as const, movement_id: movement.id as string };
}

// ════════════════════════════════════════════════════════════════════════════
// Envío al propietario — email con Excel + PDF adjuntos + link público.
// ════════════════════════════════════════════════════════════════════════════
export async function sendSettlementToOwner(settlementId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para enviar liquidaciones");
  }
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();

  const { data: detail } = await admin
    .from("owner_settlements")
    .select(
      `*, owner:owners(*), lines:settlement_lines(*, unit:units(id, code, name))`,
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!detail) throw new Error("Liquidación no encontrada");

  const owner = detail.owner as unknown as {
    full_name: string;
    email: string | null;
    bank_name: string | null;
    cbu: string | null;
    alias_cbu: string | null;
  } | null;
  if (!owner?.email) {
    throw new Error("El propietario no tiene email cargado");
  }

  const branding = await getOrganizationBranding();

  const statementInput: StatementInput = {
    id: detail.id,
    period_year: detail.period_year,
    period_month: detail.period_month,
    status: detail.status,
    currency: detail.currency,
    gross_revenue: Number(detail.gross_revenue),
    commission_amount: Number(detail.commission_amount),
    deductions_amount: Number(detail.deductions_amount),
    net_payable: Number(detail.net_payable),
    generated_at: detail.generated_at,
    sent_at: detail.sent_at,
    paid_at: detail.paid_at,
    owner: {
      full_name: owner.full_name,
      bank_name: owner.bank_name,
      cbu: owner.cbu,
      alias_cbu: owner.alias_cbu,
    },
    lines: (detail.lines ?? []) as StatementInput["lines"],
  };

  const [{ renderSettlementXlsxBuffer }, { renderSettlementPdfBuffer }] =
    await Promise.all([
      import("@/lib/excel/settlement-xlsx"),
      import("@/lib/pdf/settlement-pdf"),
    ]);
  const [xlsx, pdf] = await Promise.all([
    renderSettlementXlsxBuffer(statementInput, branding),
    renderSettlementPdfBuffer(statementInput, branding),
  ]);

  const periodLabel = formatPeriod(detail.period_year, detail.period_month);
  const net = formatMoney(Number(detail.net_payable), detail.currency);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const link = `${appUrl}/liquidacion/${detail.public_token}`;
  const brand = branding.primary_color || "#0F766E";
  const firstName = owner.full_name.split(/\s+/)[0] || owner.full_name;

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <div style="background:${brand};color:#fff;padding:22px 26px;border-radius:14px 14px 0 0">
    <div style="font-size:12px;letter-spacing:.1em;opacity:.85">${branding.name.toUpperCase()}</div>
    <div style="font-size:21px;font-weight:700;margin-top:6px">Liquidación · ${periodLabel}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 14px 14px;padding:26px">
    <p style="margin:0 0 14px">Hola ${firstName}, te compartimos tu liquidación correspondiente a <strong>${periodLabel}</strong>.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center;margin:18px 0">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.1em">Neto a transferir</div>
      <div style="font-size:28px;font-weight:800;color:${brand};margin-top:6px">${net}</div>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${link}" style="background:${brand};color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:600;display:inline-block">Ver liquidación online</a>
    </div>
    <p style="font-size:13px;color:#64748b;margin:14px 0 0">Adjuntamos el detalle completo en <strong>Excel</strong> y <strong>PDF</strong>. Ante cualquier consulta podés responder este correo.</p>
    <p style="font-size:12px;color:#94a3b8;margin:18px 0 0">${branding.name}${branding.legal_name ? " · " + branding.legal_name : ""}</p>
  </div>
</div>`.trim();

  const text = [
    `Liquidación ${periodLabel} — ${branding.name}`,
    ``,
    `Neto a transferir: ${net}`,
    `Ver online: ${link}`,
    ``,
    `Adjuntamos el detalle en Excel y PDF.`,
  ].join("\n");

  const { sendGuestMail } = await import("@/lib/email/guest");
  const sent = await sendGuestMail({
    organizationId: organization.id,
    to: owner.email,
    subject: `Liquidación ${periodLabel} · ${branding.name}`,
    html,
    text,
    attachments: [
      { filename: pdf.filename, content: pdf.buffer },
      { filename: xlsx.filename, content: xlsx.buffer },
    ],
  });
  if (!sent.ok) throw new Error(`No se pudo enviar el email: ${sent.error}`);

  const update: Record<string, unknown> = {
    sent_at: new Date().toISOString(),
    sent_to: owner.email,
  };
  if (detail.status === "borrador" || detail.status === "revisada") {
    update.status = "enviada";
  }
  await admin
    .from("owner_settlements")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);

  revalidateSettlement(id);
  return { ok: true as const, to: owner.email };
}
