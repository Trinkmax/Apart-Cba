"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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
  SettlementStatus,
  SettlementAuditEntry,
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

/**
 * Estados de reserva que se liquidan. Incluye "pendiente" (reserva sin
 * confirmar / sin pagar) — se liquida lo que está pago y lo que no.
 * Quedan afuera "cancelada" y "no_show" (no se liquida una estadía que no
 * ocurrió; pagos/reintegros de canceladas se manejan aparte en Caja).
 */
const SETTLEMENT_BOOKING_STATUSES = [
  "pendiente",
  "confirmada",
  "check_in",
  "check_out",
] as const;

/** Moneda base de la org: siempre se genera su liquidación (como hasta hoy). */
const BASE_CURRENCY = "ARS";

interface ComputedLine {
  line_type: SettlementLine["line_type"];
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  /** Moneda nativa de la línea (preserva la moneda de la reserva original). */
  currency: string;
  meta: SettlementLineMeta | null;
}

// NO exportar tipos desde un archivo "use server" (rompe el proxy de acciones
// del cliente y los componentes que importan acciones de este módulo no montan).
interface PeriodGenerationResult {
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
 *
 * Multi-moneda: cada línea trae su `currency`. Si difiere de `baseCurrency`,
 * el importe se convierte usando `exchangeRates[currency]`. Si no hay tasa
 * definida para esa moneda, esa línea cuenta como 0 (la UI debe mostrar un
 * aviso al usuario para que cargue el TC).
 */
function convertToBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  exchangeRates: Record<string, number>,
): number {
  if (currency === baseCurrency) return amount;
  const rate = Number(exchangeRates?.[currency] ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return amount * rate;
}

function computeTotals(
  lines: Array<{
    amount: number;
    sign: "+" | "-";
    line_type: SettlementLine["line_type"];
    currency?: string;
  }>,
  baseCurrency: string = BASE_CURRENCY,
  exchangeRates: Record<string, number> = {},
) {
  let gross = 0;
  let commission = 0;
  let deductions = 0;
  let net = 0;
  for (const l of lines) {
    const raw = Number(l.amount) || 0;
    const amt = convertToBase(
      raw,
      l.currency ?? baseCurrency,
      baseCurrency,
      exchangeRates,
    );
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
}): Promise<{ lines: ComputedLine[]; ticketIds: string[] }> {
  const { admin, ownerId, year, month } = opts;

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

  // Multi-moneda: traemos las reservas SIN filtrar por moneda. Cada línea
  // luego persiste su `currency` y los totales se computan convirtiendo a la
  // moneda base via `owner_settlements.exchange_rates`.
  const { data: bookings } = await admin
    .from("bookings")
    .select("*, guest:guests(full_name)")
    .in("unit_id", unitIds)
    .in("status", SETTLEMENT_BOOKING_STATUSES as unknown as string[])
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
    const bookingCurrency = (b.currency as string | null) ?? BASE_CURRENCY;

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
        currency: bookingCurrency,
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
        currency: bookingCurrency,
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
          currency: bookingCurrency,
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
      currency: bookingCurrency,
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
      currency: bookingCurrency,
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
        currency: bookingCurrency,
        meta: null,
      });
    }
  }

  for (const t of tickets ?? []) {
    const cost = Number(t.actual_cost ?? 0);
    if (cost > 0) {
      lines.push({
        line_type: "maintenance_charge",
        ref_type: "ticket",
        ref_id: t.id,
        unit_id: t.unit_id,
        description: `Mantenimiento: ${t.title}`,
        amount: round2(cost),
        sign: "-",
        currency: (t.cost_currency as string | null) ?? BASE_CURRENCY,
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
async function persistSettlement(opts: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  year: number;
  month: number;
  currency: string;
  userId: string;
  autoLines: ComputedLine[];
  ticketIds: string[];
}): Promise<{ settlement: OwnerSettlement; lineCount: number }> {
  const {
    admin,
    organizationId,
    ownerId,
    year,
    month,
    currency,
    userId,
    autoLines,
    ticketIds,
  } = opts;

  // Buscamos TODAS las liquidaciones del owner para el período (mono y multi
  // moneda). Una será el "principal" (la que casa con `currency`, default ARS);
  // el resto son "hermanas" históricas que vamos a anular y mergear.
  const { data: candidates } = await admin
    .from("owner_settlements")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("owner_id", ownerId)
    .eq("period_year", year)
    .eq("period_month", month);

  const existing =
    (candidates ?? []).find((s) => s.currency === currency) ?? null;
  const siblings = (candidates ?? []).filter(
    (s) => s.id !== existing?.id && s.status !== "anulada",
  );

  if (existing && existing.status !== "borrador") {
    throw new Error(`Esta liquidación ya está ${existing.status}; no se puede regenerar`);
  }
  for (const sib of siblings) {
    if (sib.status === "pagada" || sib.paid_movement_id) {
      throw new Error(
        `La liquidación de ${sib.currency} ${year}-${String(month).padStart(2, "0")} ya está pagada. Anulala desde su detalle antes de regenerar para unificar.`,
      );
    }
  }

  // Preservar ajustes manuales del settlement principal Y de las hermanas.
  // Las hermanas se anulan al final (status='anulada') y sus líneas manuales
  // se "trasladan" al principal manteniendo su currency original.
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

  const siblingManualLines: SettlementLine[] = [];
  if (siblings.length > 0) {
    const { data: sml } = await admin
      .from("settlement_lines")
      .select("*")
      .in(
        "settlement_id",
        siblings.map((s) => s.id),
      )
      .eq("is_manual", true);
    if (sml && sml.length > 0) {
      siblingManualLines.push(...(sml as SettlementLine[]));
    }
  }

  // Reservas cuya fila fue editada a mano: updateSettlementBookingRow marca sus
  // líneas con is_manual=true, así que ya quedaron preservadas arriba. NO volver
  // a insertar la línea automática de esas reservas — duplicaría ingreso y
  // comisión para el mismo ref_id, y entonces el editor mostraría la suma de
  // ambas líneas mientras la edición solo toca una ("se guarda pero no cambia").
  const editedBookingRefIds = new Set(
    [...manualLines, ...siblingManualLines]
      .filter((l) => l.ref_type === "booking" && l.ref_id != null)
      .map((l) => l.ref_id as string),
  );
  const autoLinesToInsert = autoLines.filter(
    (l) =>
      !(
        l.ref_type === "booking" &&
        l.ref_id != null &&
        editedBookingRefIds.has(l.ref_id)
      ),
  );

  // Tasas de cambio existentes del settlement principal (las del usuario). Las
  // preservamos al regenerar — el cliente las edita aparte vía
  // setSettlementExchangeRate.
  const exchangeRates: Record<string, number> =
    (existing?.exchange_rates as Record<string, number> | null) ?? {};

  const totals = computeTotals(
    [
      ...autoLinesToInsert.map((l) => ({
        amount: l.amount,
        sign: l.sign,
        line_type: l.line_type,
        currency: l.currency,
      })),
      ...manualLines.map((l) => ({
        amount: Number(l.amount),
        sign: l.sign,
        line_type: l.line_type,
        currency: l.currency ?? currency,
      })),
      ...siblingManualLines.map((l) => ({
        amount: Number(l.amount),
        sign: l.sign,
        line_type: l.line_type,
        currency: l.currency ?? currency,
      })),
    ],
    currency,
    exchangeRates,
  );

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

  if (autoLinesToInsert.length > 0) {
    const { error } = await admin.from("settlement_lines").insert(
      autoLinesToInsert.map((l, idx) => ({
        settlement_id: settlementId,
        line_type: l.line_type,
        ref_type: l.ref_type,
        ref_id: l.ref_id,
        unit_id: l.unit_id,
        description: l.description,
        amount: l.amount,
        sign: l.sign,
        currency: l.currency,
        is_manual: false,
        meta: l.meta,
        display_order: idx,
      })),
    );
    if (error) throw new Error(error.message);
  }

  // Reordenar los ajustes manuales del principal después de las líneas auto.
  // Updates independientes (distinto id c/u) → en paralelo, no en serie.
  if (manualLines.length > 0) {
    await Promise.all(
      manualLines.map((ml, i) =>
        admin
          .from("settlement_lines")
          .update({ display_order: autoLinesToInsert.length + i })
          .eq("id", ml.id),
      ),
    );
  }

  // Mergear hermanas: COPIAR (INSERT) las líneas manuales al settlement
  // principal y anular el documento original. Mantenemos las líneas en la
  // hermana intactas — queda como snapshot histórico read-only del documento
  // previo (auditoría). El filtro de `siblings` excluye anuladas, así que la
  // próxima regeneración no las re-procesa.
  if (siblingManualLines.length > 0) {
    const baseOffset = autoLinesToInsert.length + manualLines.length;
    const now = new Date().toISOString();
    const copies = siblingManualLines.map((l, i) => ({
      settlement_id: settlementId,
      line_type: l.line_type,
      ref_type: l.ref_type,
      ref_id: l.ref_id,
      unit_id: l.unit_id,
      description: l.description,
      amount: Number(l.amount),
      sign: l.sign,
      currency: l.currency ?? currency,
      is_manual: true,
      meta: l.meta,
      display_order: baseOffset + i,
      created_by: l.created_by ?? userId,
      updated_by: userId,
      updated_at: now,
    }));
    const { error } = await admin.from("settlement_lines").insert(copies);
    if (error) throw new Error(error.message);
  }
  if (siblings.length > 0) {
    // Sólo cambiamos status — NO tocamos líneas. La hermana anulada conserva
    // su detalle completo (totals persistidos + líneas originales) para que
    // el detalle siga mostrando el documento tal como estaba al cierre.
    await admin
      .from("owner_settlements")
      .update({
        status: "anulada",
        notes: `Mergeada al regenerar en ${currency}`,
        last_edited_by: userId,
        last_edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        siblings.map((s) => s.id),
      );
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

/** Calcula las líneas y persiste 1 liquidación owner+moneda. Sin revalidar. */
async function generateOne(opts: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  year: number;
  month: number;
  currency: string;
  userId: string;
}): Promise<{ settlement: OwnerSettlement; lineCount: number }> {
  const { admin, ownerId, year, month } = opts;
  const { lines: autoLines, ticketIds } = await buildSettlementLines({
    admin,
    ownerId,
    year,
    month,
  });
  return persistSettlement({ ...opts, autoLines, ticketIds });
}

// Helpers removidos en migración 027 (settlements multi-moneda):
//   • ownerUnitIds — el caller ya no necesitaba el listado de unidades para
//     "saltear" propietarios sin units; ahora persistSettlement lanza
//     NoUnitsError vía buildSettlementLines y el caller reporta el error.
//   • ownerCurrenciesForPeriod — el modelo viejo creaba un settlement por
//     moneda. Ahora hay un único settlement por owner+período que absorbe
//     todas las monedas en sus líneas.

/**
 * Genera (o regenera) la liquidación de un owner para un período mes/año.
 * Si está revisada/enviada/pagada, error. Preserva ajustes manuales.
 *
 * **Importante (Next.js prod):** errores esperados se devuelven como
 * `{ ok: false, reason, message }` en lugar de `throw`, porque Next.js
 * sanitiza el mensaje de cualquier excepción lanzada por un Server Action
 * en builds de producción (el cliente recibiría "An error occurred in the
 * Server Components render…" sin la causa real). Errores realmente
 * inesperados (DB, permisos) sí pueden seguir lanzándose.
 */
export async function generateSettlement(
  ownerId: string,
  year: number,
  month: number,
): Promise<
  | { ok: true; settlement: OwnerSettlement; lines: SettlementLine[] }
  | {
      ok: false;
      reason: "no_units" | "already_closed" | "forbidden" | "unknown";
      message: string;
    }
> {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "create")) {
    return {
      ok: false,
      reason: "forbidden",
      message: "No tenés permisos para generar liquidaciones",
    };
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
      // Las liquidaciones SIEMPRE se generan en ARS (moneda base). Las reservas
      // o cargos en otra moneda se incluyen en su moneda nativa y se convierten
      // al total cargando el TC del día en el detalle ("Tipos de cambio").
      currency: BASE_CURRENCY,
      userId: session.userId,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NO_UNITS") {
      return {
        ok: false,
        reason: "no_units",
        message: "El propietario no tiene unidades asignadas",
      };
    }
    if (/ya está/.test(msg)) {
      return { ok: false, reason: "already_closed", message: msg };
    }
    return { ok: false, reason: "unknown", message: msg };
  }

  // Multi-moneda: ya no creamos liquidaciones "hermanas" por moneda. La
  // liquidación principal absorbe TODAS las reservas (cada línea persiste su
  // currency) y el usuario ingresa el TC en el detalle (`exchange_rates`).
  // `persistSettlement` además anula y mergea hermanas en borrador que
  // hubieran quedado del modelo viejo (compat backward).

  const { data: linesData } = await admin
    .from("settlement_lines")
    .select("*")
    .eq("settlement_id", res.settlement.id)
    .order("display_order");

  revalidateSettlement(res.settlement.id);
  return {
    ok: true,
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

  // Cada owner es independiente: sus settlements/líneas son disjuntos por
  // owner_id y los tickets se filtran por related_owner_id (un ticket pertenece
  // a un solo owner), así que NO hay race de doble cobro. Procesamos en tandas
  // acotadas para cortar el wall-clock serial (era O(owners) × ~10 queries en
  // serie) sin saturar el pooler con orgs de muchos propietarios.
  const processOwner = async (o: {
    id: string;
    full_name: string;
  }): Promise<PeriodGenerationResult> => {
    try {
      const { lines: autoLines, ticketIds } = await buildSettlementLines({
        admin,
        ownerId: o.id,
        year,
        month,
      });
      const r = await persistSettlement({
        admin,
        organizationId: organization.id,
        ownerId: o.id,
        year,
        month,
        currency: BASE_CURRENCY,
        userId: session.userId,
        autoLines,
        ticketIds,
      });
      return {
        owner_id: o.id,
        owner_name: o.full_name,
        ok: true,
        net: Number(r.settlement.net_payable),
        currency: BASE_CURRENCY,
        lines: r.lineCount,
      };
    } catch (e) {
      const msg = (e as Error).message;
      return {
        owner_id: o.id,
        owner_name: o.full_name,
        ok: false,
        currency: BASE_CURRENCY,
        skipped:
          msg === "NO_UNITS"
            ? "Sin unidades asignadas"
            : /ya está/.test(msg)
              ? "Ya cerrada (no se regenera)"
              : msg,
      };
    }
  };

  const CONCURRENCY = 8;
  const ownerList = owners ?? [];
  const results: PeriodGenerationResult[] = [];
  for (let i = 0; i < ownerList.length; i += CONCURRENCY) {
    const chunk = ownerList.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(chunk.map(processOwner))));
  }

  revalidateSettlement();
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// Edición de líneas + impacto en Caja + auditoría
//
// Regla de negocio (confirmada con el usuario): editar una liquidación YA
// PAGADA NO reescribe el egreso original. Postea un asiento de AJUSTE en Caja
// por la diferencia de neto (ref_type='settlement_adjustment', vinculado a la
// liquidación) y deja registro en settlement_audit de quién lo hizo y qué
// cambió. Editar antes del pago solo recalcula el neto (impacta Caja al pagar).
// ════════════════════════════════════════════════════════════════════════════

type EditableSettlement = {
  id: string;
  status: string;
  organization_id: string;
  owner_id: string;
  period_year: number;
  period_month: number;
  currency: string;
  net_payable: number;
  paid_movement_id: string | null;
};

async function recomputeSettlementTotals(admin: Admin, settlementId: string) {
  // Multi-moneda: leemos también `currency` de cada línea + `currency`
  // (base) y `exchange_rates` del settlement padre, así un cambio de TC
  // recalcula correctamente sin que tengamos que rehidratar nada más.
  const [{ data: lines }, { data: parent }] = await Promise.all([
    admin
      .from("settlement_lines")
      .select("amount, sign, line_type, currency")
      .eq("settlement_id", settlementId),
    admin
      .from("owner_settlements")
      .select("currency, exchange_rates")
      .eq("id", settlementId)
      .maybeSingle(),
  ]);
  const baseCurrency = (parent?.currency as string | null) ?? BASE_CURRENCY;
  const exchangeRates =
    (parent?.exchange_rates as Record<string, number> | null) ?? {};
  const totals = computeTotals(
    (lines ?? []).map((l) => ({
      amount: Number(l.amount),
      sign: l.sign as "+" | "-",
      line_type: l.line_type as SettlementLine["line_type"],
      currency: (l.currency as string | null) ?? baseCurrency,
    })),
    baseCurrency,
    exchangeRates,
  );
  await admin.from("owner_settlements").update(totals).eq("id", settlementId);
  return totals;
}

/** Liquidación de la org y editable (cualquier estado salvo "anulada"). */
async function loadEditableSettlement(
  admin: Admin,
  organizationId: string,
  settlementId: string,
): Promise<EditableSettlement> {
  const { data: s } = await admin
    .from("owner_settlements")
    .select(
      "id, status, organization_id, owner_id, period_year, period_month, currency, net_payable, paid_movement_id",
    )
    .eq("id", settlementId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!s) throw new Error("Liquidación no encontrada");
  if (!EDITABLE_STATUSES.includes(s.status as SettlementStatus)) {
    throw new Error(
      `La liquidación está ${s.status}: anulá o regenerá antes de editar`,
    );
  }
  return { ...s, net_payable: Number(s.net_payable) } as EditableSettlement;
}

function actorNameOf(
  session: Awaited<ReturnType<typeof requireSession>>,
): string {
  return session.profile.full_name?.trim() || session.email || "Usuario";
}

/**
 * Cierra cualquier mutación de líneas: recalcula totales; si la liquidación ya
 * tiene pago registrado postea el asiento de ajuste por el delta de neto;
 * escribe la auditoría; sella last_edited_*; revalida (incluida Caja si hubo
 * asiento). Idempotente respecto a la lectura del neto previo (`before`).
 */
async function reconcileAfterEdit(opts: {
  admin: Admin;
  before: EditableSettlement;
  userId: string;
  actorName: string;
  action: SettlementAuditEntry["action"];
  changes: Record<string, unknown>;
  /** Línea humana de qué cambió (va en la descripción del asiento de Caja). */
  reason: string;
  /**
   * false = "solo visual": aplica el cambio al documento y recalcula el neto,
   * pero NO postea el asiento de ajuste en Caja aunque la liquidación esté
   * pagada (el egreso original queda intacto). Default true.
   */
  impactCaja?: boolean;
}): Promise<{
  netBefore: number;
  netAfter: number;
  delta: number;
  adjustmentId: string | null;
  visualOnly: boolean;
}> {
  const { admin, before, userId, actorName, action, changes, reason } = opts;
  const impactCaja = opts.impactCaja !== false;
  const netBefore = round2(Number(before.net_payable));

  const totals = await recomputeSettlementTotals(admin, before.id);
  const netAfter = round2(Number(totals.net_payable));
  const delta = round2(netAfter - netBefore);

  const sideEffects: string[] = [];
  if (Math.abs(delta) >= 0.005) {
    sideEffects.push(
      `Neto ${formatMoney(netBefore, before.currency)} → ${formatMoney(netAfter, before.currency)}`,
    );
  }

  // ── Impacto en Caja: solo si ya hay pago registrado Y el usuario lo pidió ──
  const visualOnly = !impactCaja;
  let adjustmentId: string | null = null;
  let adjustmentAccountId: string | null = null;
  if (before.paid_movement_id && Math.abs(delta) >= 0.01 && impactCaja) {
    const { data: payMov } = await admin
      .from("cash_movements")
      .select("account_id")
      .eq("id", before.paid_movement_id)
      .maybeSingle();
    if (payMov) {
      const periodLabel = formatPeriod(
        before.period_year,
        before.period_month,
      );
      const direction = delta > 0 ? "out" : "in";
      const amount = round2(Math.abs(delta));
      const { data: adj, error: adjErr } = await admin
        .from("cash_movements")
        .insert({
          organization_id: before.organization_id,
          account_id: payMov.account_id,
          direction,
          amount,
          currency: before.currency,
          category: "owner_settlement",
          ref_type: "settlement_adjustment",
          ref_id: before.id,
          owner_id: before.owner_id,
          billable_to: "owner",
          description: `Ajuste liquidación ${periodLabel} · ${reason} · por ${actorName}`,
          occurred_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();
      if (adjErr) {
        throw new Error(
          `No se pudo registrar el ajuste en Caja: ${adjErr.message}`,
        );
      }
      adjustmentId = adj.id as string;
      adjustmentAccountId = payMov.account_id as string;
      sideEffects.push(
        `${direction === "out" ? "Egreso" : "Ingreso"} de ajuste en Caja ${formatMoney(amount, before.currency)}`,
      );
    }
  } else if (
    before.paid_movement_id &&
    Math.abs(delta) >= 0.01 &&
    !impactCaja
  ) {
    sideEffects.push("Solo visual — sin impacto en Caja (egreso intacto)");
  } else if (!before.paid_movement_id && Math.abs(delta) >= 0.01) {
    sideEffects.push(
      impactCaja
        ? "Impacta en Caja al registrar el pago"
        : "Solo visual — sin impacto en Caja",
    );
  }

  const now = new Date().toISOString();
  await admin
    .from("owner_settlements")
    .update({ last_edited_by: userId, last_edited_at: now, updated_at: now })
    .eq("id", before.id);

  await admin.from("settlement_audit").insert({
    organization_id: before.organization_id,
    settlement_id: before.id,
    action,
    actor_user_id: userId,
    actor_name: actorName,
    changes: { ...changes, caja: impactCaja ? "impacto" : "solo_visual" },
    side_effects: sideEffects,
  });

  revalidateSettlement(before.id);
  if (adjustmentId) {
    revalidatePath("/dashboard/caja");
    if (adjustmentAccountId) {
      revalidatePath(`/dashboard/caja/${adjustmentAccountId}`);
    }
    revalidatePath("/dashboard/alertas");
    revalidatePath("/dashboard");
  }

  return { netBefore, netAfter, delta, adjustmentId, visualOnly };
}

const lineInputSchema = z.object({
  settlement_id: z.string().uuid(),
  line_type: z.enum(LINE_TYPES),
  description: z.string().min(2, "Describí el ajuste").max(200),
  unit_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive("El importe debe ser mayor a 0"),
  sign: z.enum(["+", "-"]),
  /**
   * Moneda del cargo. Default 'ARS' (la base). Útil cuando el propietario
   * recibe un gasto en USD que querés reflejar sin convertir en el documento.
   */
  currency: z.string().min(3).max(8).optional(),
  /** false = solo visual (no postea ajuste en Caja). Default true. */
  impact_caja: z.boolean().optional(),
});

export async function addSettlementLine(input: z.input<typeof lineInputSchema>) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = lineInputSchema.parse(input);
  const admin = createAdminClient();
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    v.settlement_id,
  );

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
    currency: v.currency ?? before.currency,
    is_manual: true,
    meta: null,
    display_order: nextOrder,
    created_by: session.userId,
    updated_by: session.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "line_add",
    changes: {
      description: v.description,
      amount: { from: 0, to: v.amount },
      sign: v.sign,
    },
    reason: `agregó "${v.description}" (${v.sign}${formatMoney(v.amount, before.currency)})`,
    impactCaja: v.impact_caja,
  });
}

const lineUpdateSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(2).max(200).optional(),
  amount: z.coerce.number().positive().optional(),
  sign: z.enum(["+", "-"]).optional(),
  line_type: z.enum(LINE_TYPES).optional(),
  unit_id: z.string().uuid().nullable().optional(),
  /**
   * Moneda de la línea. Necesario para corregir líneas heredadas de
   * liquidaciones mono-moneda viejas (pre-027) donde el monto en pesos quedó
   * marcado como USD y al aplicar TC se multiplica al pedo.
   */
  currency: z.string().min(3).max(8).optional(),
  /** false = solo visual (no postea ajuste en Caja). Default true. */
  impact_caja: z.boolean().optional(),
});

/** Editar una línea suelta (típicamente un "otro cargo"/ajuste). Queda
 * is_manual=true para sobrevivir una regeneración. */
export async function updateSettlementLine(
  input: z.input<typeof lineUpdateSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = lineUpdateSchema.parse(input);
  const admin = createAdminClient();

  const { data: line } = await admin
    .from("settlement_lines")
    .select("id, settlement_id, description, amount, sign, line_type, currency")
    .eq("id", v.id)
    .maybeSingle();
  if (!line) throw new Error("Línea no encontrada");
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    line.settlement_id,
  );

  const patch: Record<string, unknown> = {
    is_manual: true,
    updated_by: session.userId,
    updated_at: new Date().toISOString(),
  };
  if (v.description !== undefined) patch.description = v.description;
  if (v.amount !== undefined) patch.amount = v.amount;
  if (v.sign !== undefined) patch.sign = v.sign;
  if (v.line_type !== undefined) patch.line_type = v.line_type;
  if (v.unit_id !== undefined) patch.unit_id = v.unit_id;
  if (v.currency !== undefined) patch.currency = v.currency;

  const { error } = await admin
    .from("settlement_lines")
    .update(patch)
    .eq("id", v.id);
  if (error) throw new Error(error.message);

  const changes: Record<string, unknown> = {};
  if (v.amount !== undefined && Number(line.amount) !== v.amount) {
    changes.amount = { from: Number(line.amount), to: v.amount };
  }
  if (v.sign !== undefined && line.sign !== v.sign) {
    changes.sign = { from: line.sign, to: v.sign };
  }
  if (v.description !== undefined && line.description !== v.description) {
    changes.description = { from: line.description, to: v.description };
  }
  if (v.currency !== undefined && line.currency !== v.currency) {
    changes.currency = { from: line.currency, to: v.currency };
  }

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "line_update",
    changes: { line: line.description, ...changes },
    reason: `editó "${line.description}"`,
    impactCaja: v.impact_caja,
  });
}

export async function deleteSettlementLine(
  lineId: string,
  impactCaja: boolean = true,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const id = z.string().uuid().parse(lineId);
  const admin = createAdminClient();

  const { data: line } = await admin
    .from("settlement_lines")
    .select("id, settlement_id, description, amount, sign")
    .eq("id", id)
    .maybeSingle();
  if (!line) throw new Error("Línea no encontrada");
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    line.settlement_id,
  );

  const { error } = await admin.from("settlement_lines").delete().eq("id", id);
  if (error) throw new Error(error.message);

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "line_delete",
    changes: {
      description: line.description,
      amount: { from: Number(line.amount), to: 0 },
      sign: line.sign,
    },
    reason: `eliminó "${line.description}"`,
    impactCaja,
  });
}

/** Quita una reserva completa de la liquidación (todas las líneas del grupo)
 * en una sola operación → un único asiento de ajuste si está pagada. */
export async function removeSettlementBookingRow(input: {
  settlement_id: string;
  ref_id: string;
  impact_caja?: boolean;
}) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const settlementId = z.string().uuid().parse(input.settlement_id);
  const refId = z.string().uuid().parse(input.ref_id);
  const admin = createAdminClient();
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    settlementId,
  );

  const { data: group } = await admin
    .from("settlement_lines")
    .select("id, description, meta")
    .eq("settlement_id", settlementId)
    .eq("ref_type", "booking")
    .eq("ref_id", refId);
  if (!group || group.length === 0) {
    throw new Error("Reserva no encontrada en la liquidación");
  }
  const label =
    (group.find((g) => g.meta)?.meta as SettlementLineMeta | null)
      ?.guest_name ?? "Reserva";

  const { error } = await admin
    .from("settlement_lines")
    .delete()
    .eq("settlement_id", settlementId)
    .eq("ref_type", "booking")
    .eq("ref_id", refId);
  if (error) throw new Error(error.message);

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "line_delete",
    changes: { reserva: label, lineas_eliminadas: group.length },
    reason: `quitó la reserva de ${label}`,
    impactCaja: input.impact_caja,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Editar una fila de reserva de la planilla — "liquidar más/menos noches".
// Toca de forma atómica las 3 líneas del grupo (ingreso + comisión + gastos),
// actualiza el snapshot meta (noches/fechas/huésped) y reconcilia Caja+audit.
// ════════════════════════════════════════════════════════════════════════════
const bookingRowSchema = z.object({
  settlement_id: z.string().uuid(),
  ref_id: z.string().uuid(),
  nights: z.coerce.number().int().min(0).max(366),
  gross: z.coerce.number().min(0, "El bruto no puede ser negativo"),
  commission: z.coerce.number().min(0),
  expenses: z.coerce.number().min(0),
  guest_name: z.string().max(160).optional().nullable(),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /**
   * Moneda del grupo. Se aplica a las 3 líneas (ingreso + comisión + gastos)
   * para mantener consistencia: una reserva vive en una sola moneda.
   * Si no se manda, las líneas conservan su currency actual.
   */
  currency: z.string().min(3).max(8).optional(),
  /** false = solo visual (no postea ajuste en Caja). Default true. */
  impact_caja: z.boolean().optional(),
});

export async function updateSettlementBookingRow(
  input: z.input<typeof bookingRowSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = bookingRowSchema.parse(input);
  const admin = createAdminClient();
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    v.settlement_id,
  );

  const { data: groupRaw } = await admin
    .from("settlement_lines")
    .select("*, unit:units(id, code, name)")
    .eq("settlement_id", v.settlement_id)
    .eq("ref_type", "booking")
    .eq("ref_id", v.ref_id)
    .order("display_order");
  const group = (groupRaw ?? []) as Array<
    SettlementLine & { unit: { id: string; code: string; name: string } | null }
  >;
  if (group.length === 0) throw new Error("Reserva no encontrada en la liquidación");

  // Una reserva puede tener líneas de ingreso/comisión DUPLICADAS para el mismo
  // ref_id (regeneraciones previas las generaban). statement-model las SUMA al
  // dibujar la fila, así que el editor abre con esa suma; pero la edición solo
  // toca una línea. Tomamos la primera como canónica y colapsamos las sobrantes
  // —igual que ya se hace con los gastos— para que la liquidación quede sana y
  // la edición se refleje 1:1.
  const primaryRevenueLines = group.filter(
    (g) =>
      g.sign === "+" &&
      (g.line_type === "booking_revenue" ||
        g.line_type === "monthly_rent_fraction"),
  );
  const revenueLines =
    primaryRevenueLines.length > 0
      ? primaryRevenueLines
      : group.filter((g) => g.sign === "+");
  const revenue = revenueLines[0];
  if (!revenue) throw new Error("La reserva no tiene línea de ingreso");
  const commissionLines = group.filter((g) => g.line_type === "commission");
  const commissionLine = commissionLines[0];
  const deductionLines = group.filter(
    (g) => g.sign === "-" && g.line_type !== "commission",
  );
  // Líneas de ingreso/comisión duplicadas a eliminar (queda solo la primera).
  const staleDuplicateIds = [
    ...revenueLines.slice(1),
    ...commissionLines.slice(1),
  ].map((g) => g.id);

  const oldMeta: SettlementLineMeta = revenue.meta ?? {};
  const oldNights = oldMeta.nights ?? null;
  // Los valores "viejos" para el historial reflejan lo que el usuario veía en
  // la planilla: la SUMA del grupo (statement-model agrupa por ref_id y suma).
  const oldGross = round2(
    revenueLines.reduce((a, g) => a + Number(g.amount), 0),
  );
  const oldCommission = round2(
    commissionLines.reduce((a, g) => a + Number(g.amount), 0),
  );
  const oldExpenses = round2(
    deductionLines.reduce((a, g) => a + Number(g.amount), 0),
  );

  const unitCode = revenue.unit?.code ?? "—";
  const checkIn = v.check_in ?? oldMeta.check_in ?? null;
  const checkOut = v.check_out ?? oldMeta.check_out ?? null;
  const guestName = v.guest_name?.trim() || oldMeta.guest_name || null;
  const commissionPct =
    v.gross > 0 ? round2((v.commission / v.gross) * 100) : oldMeta.commission_pct ?? null;
  const isMensual = oldMeta.mode === "mensual";
  const rangeLabel =
    checkIn && checkOut ? `${checkIn} → ${checkOut}` : `${v.nights} noches`;
  const newDescription = isMensual
    ? `Renta mensual ${rangeLabel} (${v.nights}${oldMeta.prorate_of ? `/${oldMeta.prorate_of}` : ""} días) — ${unitCode}`
    : `Reserva ${rangeLabel} (${unitCode})`;
  const newMeta: SettlementLineMeta = {
    ...oldMeta,
    nights: v.nights,
    check_in: checkIn,
    check_out: checkOut,
    guest_name: guestName,
    commission_pct: commissionPct,
  };

  const now = new Date().toISOString();
  // El grupo siempre vive en una sola moneda — si el usuario la cambió, la
  // aplicamos a todas las líneas que toquemos abajo. Si no, conservamos la
  // que ya tenía la línea de ingreso (que define la moneda del grupo).
  const groupCurrency = v.currency ?? revenue.currency;
  const stamp = {
    is_manual: true,
    updated_by: session.userId,
    updated_at: now,
  };
  const stampCurrency =
    v.currency !== undefined ? { currency: groupCurrency } : {};

  // 1) Línea de ingreso
  {
    const { error } = await admin
      .from("settlement_lines")
      .update({
        ...stamp,
        ...stampCurrency,
        amount: round2(v.gross),
        description: newDescription,
        meta: newMeta,
      })
      .eq("id", revenue.id);
    if (error) throw new Error(error.message);
  }

  // 2) Comisión
  if (commissionLine) {
    const { error } = await admin
      .from("settlement_lines")
      .update({
        ...stamp,
        ...stampCurrency,
        amount: round2(v.commission),
        description: `Comisión${commissionPct != null ? ` ${commissionPct}%` : ""}${isMensual ? " (mensual prorrateada)" : ""}`,
      })
      .eq("id", commissionLine.id);
    if (error) throw new Error(error.message);
  } else if (v.commission > 0) {
    const { error } = await admin.from("settlement_lines").insert({
      settlement_id: v.settlement_id,
      line_type: "commission",
      ref_type: "booking",
      ref_id: v.ref_id,
      unit_id: revenue.unit_id,
      description: `Comisión${commissionPct != null ? ` ${commissionPct}%` : ""}`,
      amount: round2(v.commission),
      sign: "-",
      currency: groupCurrency,
      meta: null,
      display_order: (revenue.display_order ?? 0) + 1,
      created_by: session.userId,
      ...stamp,
    });
    if (error) throw new Error(error.message);
  }

  // 3) Gastos — colapsamos a una sola línea "Gastos" (lo que muestra la
  //    planilla por fila). Reescribimos la primera, borramos sobrantes.
  if (v.expenses > 0) {
    if (deductionLines.length > 0) {
      const keep = deductionLines[0];
      const { error } = await admin
        .from("settlement_lines")
        .update({
          ...stamp,
          ...stampCurrency,
          line_type: "expenses_fraction",
          amount: round2(v.expenses),
          description: "Gastos",
        })
        .eq("id", keep.id);
      if (error) throw new Error(error.message);
      const extra = deductionLines.slice(1).map((g) => g.id);
      if (extra.length > 0) {
        await admin.from("settlement_lines").delete().in("id", extra);
      }
    } else {
      const { error } = await admin.from("settlement_lines").insert({
        settlement_id: v.settlement_id,
        line_type: "expenses_fraction",
        ref_type: "booking",
        ref_id: v.ref_id,
        unit_id: revenue.unit_id,
        description: "Gastos",
        amount: round2(v.expenses),
        sign: "-",
        currency: groupCurrency,
        meta: null,
        display_order: (revenue.display_order ?? 0) + 2,
        created_by: session.userId,
        ...stamp,
      });
      if (error) throw new Error(error.message);
    }
  } else if (deductionLines.length > 0) {
    await admin
      .from("settlement_lines")
      .delete()
      .in(
        "id",
        deductionLines.map((g) => g.id),
      );
  }

  // 4) Eliminar las líneas de ingreso/comisión duplicadas del grupo. Esto
  //    auto-sana las liquidaciones afectadas por la duplicación histórica: con
  //    una sola línea de cada tipo, recomputeSettlementTotals vuelve a dar el
  //    total correcto y la fila pasa a mostrar exactamente lo editado.
  if (staleDuplicateIds.length > 0) {
    const { error } = await admin
      .from("settlement_lines")
      .delete()
      .in("id", staleDuplicateIds);
    if (error) throw new Error(error.message);
  }

  const currencyChanged =
    v.currency !== undefined && v.currency !== revenue.currency;

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "row_update",
    changes: {
      reserva: guestName ?? unitCode,
      noches: { from: oldNights, to: v.nights },
      bruto: { from: oldGross, to: round2(v.gross) },
      comision: { from: oldCommission, to: round2(v.commission) },
      gastos: { from: oldExpenses, to: round2(v.expenses) },
      ...(currencyChanged
        ? { moneda: { from: revenue.currency, to: groupCurrency } }
        : {}),
    },
    reason:
      oldNights != null && oldNights !== v.nights
        ? `${guestName ?? unitCode}: ${oldNights}→${v.nights} noches`
        : `${guestName ?? unitCode}: bruto ${formatMoney(oldGross, before.currency)} → ${formatMoney(v.gross, before.currency)}`,
    impactCaja: v.impact_caja,
  });
}

const addBookingRowSchema = z.object({
  settlement_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  guest_name: z.string().trim().max(160).optional().nullable(),
  check_in: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  check_out: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  nights: z.coerce.number().int().min(0).max(366),
  gross: z.coerce.number().min(0, "El bruto no puede ser negativo"),
  commission: z.coerce.number().min(0),
  expenses: z.coerce.number().min(0),
  /** Moneda de la reserva cargada a mano. Default = base del settlement. */
  currency: z.string().min(3).max(8).optional(),
});

/**
 * Agrega una reserva cargada a mano a la liquidación: un grupo de líneas
 * (ingreso + comisión + gastos) con ref_type='booking' y un ref_id SINTÉTICO
 * — no apunta a ninguna fila de `bookings`. Suma al neto del documento pero NO
 * crea una reserva en el calendario ni mueve Caja (reconcilia con
 * impactCaja=false). Queda is_manual=true: se edita/elimina como cualquier fila
 * y sobrevive a "Regenerar" (buildSettlementLines nunca recrea un ref_id que no
 * corresponde a una reserva real).
 */
export async function addSettlementBookingRow(
  input: z.input<typeof addBookingRowSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = addBookingRowSchema.parse(input);
  const admin = createAdminClient();
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    v.settlement_id,
  );

  const { data: unit } = await admin
    .from("units")
    .select("id, code")
    .eq("id", v.unit_id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!unit) throw new Error("Unidad no encontrada");

  // ref_id sintético: agrupa las líneas como una fila de reserva en la planilla
  // sin tocar la tabla `bookings`.
  const refId = randomUUID();
  const now = new Date().toISOString();

  const { data: last } = await admin
    .from("settlement_lines")
    .select("display_order")
    .eq("settlement_id", v.settlement_id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseOrder = (Number(last?.display_order ?? -1) || 0) + 1;

  const commissionPct =
    v.gross > 0 ? round2((v.commission / v.gross) * 100) : null;
  const guestName = v.guest_name?.trim() || null;
  const rangeLabel =
    v.check_in && v.check_out
      ? `${v.check_in} → ${v.check_out}`
      : `${v.nights} noches`;

  const lineCurrency = v.currency ?? before.currency;
  const stamp = {
    is_manual: true,
    created_by: session.userId,
    updated_by: session.userId,
    updated_at: now,
  };

  const lines: Array<Record<string, unknown>> = [
    {
      settlement_id: v.settlement_id,
      line_type: "booking_revenue",
      ref_type: "booking",
      ref_id: refId,
      unit_id: v.unit_id,
      description: `Reserva ${rangeLabel} (${unit.code})`,
      amount: round2(v.gross),
      sign: "+",
      currency: lineCurrency,
      meta: {
        guest_name: guestName,
        nights: v.nights,
        check_in: v.check_in ?? null,
        check_out: v.check_out ?? null,
        source: "manual",
        mode: "temporario",
        commission_pct: commissionPct,
      },
      display_order: baseOrder,
      ...stamp,
    },
  ];
  if (v.commission > 0) {
    lines.push({
      settlement_id: v.settlement_id,
      line_type: "commission",
      ref_type: "booking",
      ref_id: refId,
      unit_id: v.unit_id,
      description: `Comisión${commissionPct != null ? ` ${commissionPct}%` : ""}`,
      amount: round2(v.commission),
      sign: "-",
      currency: lineCurrency,
      meta: null,
      display_order: baseOrder + 1,
      ...stamp,
    });
  }
  if (v.expenses > 0) {
    lines.push({
      settlement_id: v.settlement_id,
      line_type: "expenses_fraction",
      ref_type: "booking",
      ref_id: refId,
      unit_id: v.unit_id,
      description: "Gastos",
      amount: round2(v.expenses),
      sign: "-",
      currency: lineCurrency,
      meta: null,
      display_order: baseOrder + 2,
      ...stamp,
    });
  }

  const { error } = await admin.from("settlement_lines").insert(lines);
  if (error) throw new Error(error.message);

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "row_add",
    changes: {
      reserva: guestName ?? unit.code,
      bruto: { from: 0, to: round2(v.gross) },
      comision: { from: 0, to: round2(v.commission) },
      gastos: { from: 0, to: round2(v.expenses) },
    },
    reason: `agregó la reserva de ${guestName ?? unit.code} (${formatMoney(v.gross, before.currency)})`,
    impactCaja: false,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Reordenamiento y movimiento — no cambian totales ni neto, solo posiciones
// (display_order / unit_order). No reconcilian Caja porque no afectan saldo.
// Sí sellan last_edited_* + audit para que el cambio quede trazado.
// ════════════════════════════════════════════════════════════════════════════

async function loadEditableSettlementMinimal(
  admin: Admin,
  organizationId: string,
  settlementId: string,
): Promise<{ id: string; status: string; organization_id: string }> {
  const { data: s } = await admin
    .from("owner_settlements")
    .select("id, status, organization_id")
    .eq("id", settlementId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!s) throw new Error("Liquidación no encontrada");
  if (!EDITABLE_STATUSES.includes(s.status as SettlementStatus)) {
    throw new Error(
      `La liquidación está ${s.status}: anulá o regenerá antes de editar`,
    );
  }
  return s as { id: string; status: string; organization_id: string };
}

async function sealOrderEdit(
  admin: Admin,
  settlementId: string,
  organizationId: string,
  userId: string,
  actorName: string,
  action: SettlementAuditEntry["action"],
  changes: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  await admin
    .from("owner_settlements")
    .update({ last_edited_by: userId, last_edited_at: now, updated_at: now })
    .eq("id", settlementId);
  await admin.from("settlement_audit").insert({
    organization_id: organizationId,
    settlement_id: settlementId,
    action,
    actor_user_id: userId,
    actor_name: actorName,
    changes,
    side_effects: [],
  });
  revalidateSettlement(settlementId);
}

const reorderLinesSchema = z.object({
  settlement_id: z.string().uuid(),
  ordered_line_ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Reordena los "Otros cargos" (líneas sueltas — ref_type != 'booking') de una
 * liquidación. Recibe el array completo de line IDs en el orden deseado y
 * reescribe `display_order` para reflejarlo. No toca líneas de booking ni
 * cambia totales.
 */
export async function reorderSettlementLines(
  input: z.input<typeof reorderLinesSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = reorderLinesSchema.parse(input);
  const admin = createAdminClient();
  const s = await loadEditableSettlementMinimal(
    admin,
    organization.id,
    v.settlement_id,
  );

  // Verifica que TODAS las líneas pertenezcan a este settlement y NO sean
  // de booking (los reorden de reservas usan otra action).
  const { data: lines } = await admin
    .from("settlement_lines")
    .select("id, ref_type, display_order")
    .eq("settlement_id", s.id)
    .in("id", v.ordered_line_ids);
  if (!lines || lines.length !== v.ordered_line_ids.length) {
    throw new Error("Líneas no encontradas o no pertenecen a esta liquidación");
  }
  if (lines.some((l) => l.ref_type === "booking")) {
    throw new Error(
      "No se pueden reordenar líneas de reserva desde acá (usá reorderSettlementBookings)",
    );
  }

  // Reservamos el bloque de display_order más alto para no chocar con valores
  // existentes durante el update (no hay constraint UNIQUE pero igual evita
  // estados intermedios visibles a otras lecturas).
  const { data: maxRow } = await admin
    .from("settlement_lines")
    .select("display_order")
    .eq("settlement_id", s.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = Number(maxRow?.display_order ?? 0) + 1000;

  for (let i = 0; i < v.ordered_line_ids.length; i++) {
    const { error } = await admin
      .from("settlement_lines")
      .update({ display_order: base + i })
      .eq("id", v.ordered_line_ids[i])
      .eq("settlement_id", s.id);
    if (error) throw new Error(error.message);
  }

  await sealOrderEdit(
    admin,
    s.id,
    organization.id,
    session.userId,
    actorNameOf(session),
    "line_update",
    { kind: "reorder_lines", count: v.ordered_line_ids.length },
  );

  return { ok: true as const };
}

const reorderBookingsSchema = z.object({
  settlement_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  ordered_ref_ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Reordena las RESERVAS dentro de una unidad. Recibe los ref_id de los grupos
 * (cada grupo = 3 líneas: ingreso + comisión + gastos) y reescribe el
 * display_order de las 3 líneas de cada grupo, manteniendo el offset interno.
 */
export async function reorderSettlementBookings(
  input: z.input<typeof reorderBookingsSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = reorderBookingsSchema.parse(input);
  const admin = createAdminClient();
  const s = await loadEditableSettlementMinimal(
    admin,
    organization.id,
    v.settlement_id,
  );

  const { data: lines } = await admin
    .from("settlement_lines")
    .select("id, ref_id, line_type, display_order, unit_id")
    .eq("settlement_id", s.id)
    .eq("ref_type", "booking")
    .in("ref_id", v.ordered_ref_ids);
  if (!lines || lines.length === 0) {
    throw new Error("Reservas no encontradas");
  }

  // Agrupar por ref_id manteniendo el offset interno (booking_revenue=0,
  // commission=1, expenses_fraction/otros=2). Si la línea no es revenue ni
  // commission, asignamos offset según orden actual relativo dentro del grupo.
  const groups = new Map<
    string,
    Array<{ id: string; line_type: string; currentOrder: number }>
  >();
  for (const l of lines) {
    if (!l.ref_id) continue;
    const arr = groups.get(l.ref_id) ?? [];
    arr.push({
      id: l.id,
      line_type: l.line_type,
      currentOrder: Number(l.display_order ?? 0),
    });
    groups.set(l.ref_id, arr);
  }
  for (const ref of v.ordered_ref_ids) {
    if (!groups.has(ref)) {
      throw new Error("Una de las reservas no existe en la liquidación");
    }
  }

  // Reserva un bloque alto para evitar choques durante el update.
  const { data: maxRow } = await admin
    .from("settlement_lines")
    .select("display_order")
    .eq("settlement_id", s.id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = Number(maxRow?.display_order ?? 0) + 1000;

  // Cada grupo ocupa 10 slots — sobra para los <=3 líneas y deja "huecos"
  // por si se agregan más líneas al grupo a futuro.
  const STEP = 10;
  for (let i = 0; i < v.ordered_ref_ids.length; i++) {
    const ref = v.ordered_ref_ids[i];
    const grp = groups.get(ref)!;
    // Conservamos el orden relativo actual entre las líneas del grupo —
    // así revenue queda primero, comisión segundo, etc.
    grp.sort((a, b) => a.currentOrder - b.currentOrder);
    const slotBase = base + i * STEP;
    for (let j = 0; j < grp.length; j++) {
      const { error } = await admin
        .from("settlement_lines")
        .update({ display_order: slotBase + j })
        .eq("id", grp[j].id);
      if (error) throw new Error(error.message);
    }
  }

  await sealOrderEdit(
    admin,
    s.id,
    organization.id,
    session.userId,
    actorNameOf(session),
    "row_update",
    {
      kind: "reorder_bookings",
      unit_id: v.unit_id,
      count: v.ordered_ref_ids.length,
    },
  );

  return { ok: true as const };
}

const reorderUnitsSchema = z.object({
  settlement_id: z.string().uuid(),
  ordered_unit_ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Persiste el orden personalizado de unidades del documento en
 * `owner_settlements.unit_order` (jsonb). Las unidades fuera del array caen
 * al final ordenadas alfabéticamente por code (ver buildStatementModel).
 */
export async function reorderSettlementUnits(
  input: z.input<typeof reorderUnitsSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = reorderUnitsSchema.parse(input);
  const admin = createAdminClient();
  const s = await loadEditableSettlementMinimal(
    admin,
    organization.id,
    v.settlement_id,
  );

  const now = new Date().toISOString();
  const { error } = await admin
    .from("owner_settlements")
    .update({
      unit_order: v.ordered_unit_ids,
      last_edited_by: session.userId,
      last_edited_at: now,
      updated_at: now,
    })
    .eq("id", s.id);
  if (error) throw new Error(error.message);

  await admin.from("settlement_audit").insert({
    organization_id: organization.id,
    settlement_id: s.id,
    action: "row_update",
    actor_user_id: session.userId,
    actor_name: actorNameOf(session),
    changes: { kind: "reorder_units", count: v.ordered_unit_ids.length },
    side_effects: [],
  });
  revalidateSettlement(s.id);

  return { ok: true as const };
}

const moveBookingSchema = z.object({
  settlement_id: z.string().uuid(),
  ref_id: z.string().uuid(),
  new_unit_id: z.string().uuid(),
});

/**
 * Mueve una reserva (las 3 líneas con el mismo ref_id) a otra unidad del
 * MISMO propietario. Valida que la unidad destino pertenezca a un owner
 * de esta org. No cambia totales ni mueve Caja.
 */
export async function moveSettlementBookingRow(
  input: z.input<typeof moveBookingSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = moveBookingSchema.parse(input);
  const admin = createAdminClient();
  const s = await loadEditableSettlementMinimal(
    admin,
    organization.id,
    v.settlement_id,
  );

  // Verificamos que la unidad destino exista en la org y esté asignada al
  // mismo propietario de la liquidación.
  const { data: settlementRow } = await admin
    .from("owner_settlements")
    .select("owner_id")
    .eq("id", s.id)
    .maybeSingle();
  if (!settlementRow) throw new Error("Liquidación no encontrada");

  const { data: ownerLink } = await admin
    .from("unit_owners")
    .select("unit:units!inner(id, code, name, organization_id)")
    .eq("owner_id", settlementRow.owner_id)
    .eq("unit_id", v.new_unit_id)
    .maybeSingle();
  type LinkedUnit = {
    id: string;
    code: string;
    name: string;
    organization_id: string;
  };
  const destUnit = (ownerLink?.unit as unknown as LinkedUnit | null) ?? null;
  if (!destUnit || destUnit.organization_id !== organization.id) {
    throw new Error("La unidad destino no pertenece a este propietario");
  }

  // Capturamos la unidad origen para el audit (de la línea de revenue).
  const { data: existing } = await admin
    .from("settlement_lines")
    .select("id, unit_id, line_type, unit:units(code, name)")
    .eq("settlement_id", s.id)
    .eq("ref_type", "booking")
    .eq("ref_id", v.ref_id);
  if (!existing || existing.length === 0) {
    throw new Error("Reserva no encontrada en la liquidación");
  }
  const revenue =
    existing.find((l) => l.line_type === "booking_revenue") ?? existing[0];
  type FromUnit = { code: string; name: string };
  const fromUnit =
    (revenue.unit as unknown as FromUnit | null) ?? null;
  const fromUnitId = revenue.unit_id;
  if (fromUnitId === v.new_unit_id) {
    return { ok: true as const, noop: true };
  }

  const { error } = await admin
    .from("settlement_lines")
    .update({
      unit_id: v.new_unit_id,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("settlement_id", s.id)
    .eq("ref_type", "booking")
    .eq("ref_id", v.ref_id);
  if (error) throw new Error(error.message);

  await sealOrderEdit(
    admin,
    s.id,
    organization.id,
    session.userId,
    actorNameOf(session),
    "row_update",
    {
      kind: "move_booking_unit",
      unit: {
        from: fromUnit?.code ?? "—",
        to: destUnit.code,
      },
    },
  );

  return { ok: true as const };
}

const exchangeRateSchema = z.object({
  settlement_id: z.string().uuid(),
  currency: z.string().min(3).max(8),
  /** 0 = borrar la tasa (líneas en esa moneda dejan de sumar al total). */
  rate: z.coerce.number().min(0).max(1_000_000),
});

/**
 * Setea (o borra) la tasa de cambio de una moneda contra la moneda base de la
 * liquidación. Persiste en `owner_settlements.exchange_rates` (jsonb) y
 * dispara un recálculo de totales. Si la liquidación está pagada, postea el
 * asiento de ajuste por la diferencia de neto.
 */
export async function setSettlementExchangeRate(
  input: z.input<typeof exchangeRateSchema>,
) {
  const session = await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "update")) {
    throw new Error("No tenés permisos para editar liquidaciones");
  }
  const v = exchangeRateSchema.parse(input);
  const admin = createAdminClient();
  const before = await loadEditableSettlement(
    admin,
    organization.id,
    v.settlement_id,
  );

  if (v.currency === before.currency) {
    throw new Error("La moneda base no necesita tipo de cambio");
  }

  const { data: parent } = await admin
    .from("owner_settlements")
    .select("exchange_rates")
    .eq("id", v.settlement_id)
    .maybeSingle();
  const prevRates =
    (parent?.exchange_rates as Record<string, number> | null) ?? {};
  const previous = Number(prevRates[v.currency] ?? 0);

  const nextRates: Record<string, number> = { ...prevRates };
  if (v.rate <= 0) {
    delete nextRates[v.currency];
  } else {
    nextRates[v.currency] = round2(v.rate);
  }

  const { error } = await admin
    .from("owner_settlements")
    .update({ exchange_rates: nextRates })
    .eq("id", v.settlement_id);
  if (error) throw new Error(error.message);

  return reconcileAfterEdit({
    admin,
    before,
    userId: session.userId,
    actorName: actorNameOf(session),
    action: "line_update",
    changes: {
      kind: "exchange_rate",
      currency: v.currency,
      rate: { from: previous, to: v.rate },
    },
    reason: `actualizó TC ${v.currency} a ${v.rate}`,
    impactCaja: true,
  });
}

/** Historial de cambios de la liquidación (más recientes primero). */
export async function listSettlementAudit(
  settlementId: string,
): Promise<SettlementAuditEntry[]> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) {
    throw new Error("No tenés permisos para ver liquidaciones");
  }
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("owner_settlements")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!s) return [];
  const { data, error } = await admin
    .from("settlement_audit")
    .select(
      "id, settlement_id, action, actor_user_id, actor_name, changes, side_effects, occurred_at",
    )
    .eq("organization_id", organization.id)
    .eq("settlement_id", id)
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as SettlementAuditEntry[];
}

// ════════════════════════════════════════════════════════════════════════════
// Lecturas
// ════════════════════════════════════════════════════════════════════════════

export async function listSettlements(filters?: {
  ownerId?: string;
  year?: number;
  month?: number;
  /**
   * Por defecto ocultamos las liquidaciones anuladas — desde la migración 027
   * las "hermanas" mono-moneda viejas se anulan al regenerar el documento
   * unificado y aparecerían como duplicadas en el listado principal.
   */
  includeAnuladas?: boolean;
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
  if (!filters?.includeAnuladas) q = q.neq("status", "anulada");
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
 * Unidades del propietario de una liquidación. Alimenta los selectores de
 * unidad del detalle ("Agregar reserva", "Agregar cargo").
 */
export async function listOwnerUnits(
  ownerId: string,
): Promise<Array<{ id: string; code: string; name: string }>> {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) return [];
  const oid = z.string().uuid().parse(ownerId);
  const admin = createAdminClient();
  const { data } = await admin
    .from("unit_owners")
    .select("unit:units(id, code, name, organization_id)")
    .eq("owner_id", oid);
  type U = { id: string; code: string; name: string; organization_id: string };
  return (data ?? [])
    .map((r) => r.unit as unknown as U | null)
    .filter((u): u is U => !!u && u.organization_id === organization.id)
    .map((u) => ({ id: u.id, code: u.code, name: u.name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Otras liquidaciones del MISMO propietario y período en OTRAS monedas.
 * Las liquidaciones son por moneda (no se pueden sumar USD + ARS), así que
 * desde el detalle se linkean las hermanas para que no "desaparezcan".
 */
export async function listSettlementSiblings(
  settlementId: string,
): Promise<
  Array<{ id: string; currency: string; status: string; net_payable: number }>
> {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) return [];
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();

  const { data: base } = await admin
    .from("owner_settlements")
    .select("owner_id, period_year, period_month")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!base) return [];

  // Excluimos las anuladas — desde la migración 027 las hermanas mono-moneda
  // se anulan al regenerar el documento unificado, y mostrarlas confunde
  // (parecería que hay "dos liquidaciones del mismo período" cuando en
  // realidad la principal absorbió las líneas de la otra).
  const { data } = await admin
    .from("owner_settlements")
    .select("id, currency, status, net_payable")
    .eq("organization_id", organization.id)
    .eq("owner_id", base.owner_id)
    .eq("period_year", base.period_year)
    .eq("period_month", base.period_month)
    .neq("id", id)
    .neq("status", "anulada")
    .order("currency");

  return (data ?? []).map((s) => ({
    id: s.id as string,
    currency: s.currency as string,
    status: s.status as string,
    net_payable: Number(s.net_payable),
  }));
}

/**
 * Liquidaciones del mismo período/owner que fueron ANULADAS al absorberlas en
 * este documento (notes='Mergeada al regenerar en ...'). Sirve para mostrar
 * un banner "Esta liquidación absorbió X documento(s) archivado(s)" con link
 * al detalle read-only — así el usuario confirma visualmente que el merge
 * pasó OK y no perdió nada.
 */
export async function listSettlementMergedSiblings(
  settlementId: string,
): Promise<
  Array<{
    id: string;
    currency: string;
    net_payable: number;
    generated_at: string | null;
    notes: string | null;
  }>
> {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) return [];
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();

  const { data: base } = await admin
    .from("owner_settlements")
    .select("owner_id, period_year, period_month")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!base) return [];

  const { data } = await admin
    .from("owner_settlements")
    .select("id, currency, net_payable, generated_at, notes")
    .eq("organization_id", organization.id)
    .eq("owner_id", base.owner_id)
    .eq("period_year", base.period_year)
    .eq("period_month", base.period_month)
    .neq("id", id)
    .eq("status", "anulada")
    .order("currency");

  return (data ?? []).map((s) => ({
    id: s.id as string,
    currency: s.currency as string,
    net_payable: Number(s.net_payable),
    generated_at: s.generated_at as string | null,
    notes: s.notes as string | null,
  }));
}

/**
 * Pre-flight para el botón "Regenerar" en el detalle: detecta si la
 * regeneración va a ANULAR hermanas mono-moneda en otros currencies. La UI
 * muestra un AlertDialog con la lista antes de proceder, así el usuario no
 * cree que se perdieron al ver el listado.
 */
export async function previewRegenerateMergeImpact(
  settlementId: string,
): Promise<
  Array<{
    id: string;
    currency: string;
    status: string;
    net_payable: number;
  }>
> {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "create")) return [];
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();

  const { data: base } = await admin
    .from("owner_settlements")
    .select("owner_id, period_year, period_month")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!base) return [];

  // Hermanas activas (no anuladas) — son las que se mergerían al regenerar.
  const { data } = await admin
    .from("owner_settlements")
    .select("id, currency, status, net_payable")
    .eq("organization_id", organization.id)
    .eq("owner_id", base.owner_id)
    .eq("period_year", base.period_year)
    .eq("period_month", base.period_month)
    .neq("id", id)
    .neq("status", "anulada")
    .order("currency");

  return (data ?? []).map((s) => ({
    id: s.id as string,
    currency: s.currency as string,
    status: s.status as string,
    net_payable: Number(s.net_payable),
  }));
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
 * con su cantidad de unidades y TODAS sus liquidaciones de ese período (una
 * por moneda: ARS, USD, etc.).
 */
export async function listOwnersForPeriod(year: number, month: number) {
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
      .order("currency"),
    unitIds.length
      ? admin.from("unit_owners").select("owner_id, unit_id").in("unit_id", unitIds)
      : Promise.resolve({ data: [] as Array<{ owner_id: string; unit_id: string }> }),
  ]);

  const unitCount = new Map<string, number>();
  for (const r of uo ?? [])
    unitCount.set(r.owner_id, (unitCount.get(r.owner_id) ?? 0) + 1);

  type PeriodSettlement = {
    id: string;
    owner_id: string;
    status: string;
    net_payable: number;
    currency: string;
    generated_at: string | null;
  };
  const byOwner = new Map<string, PeriodSettlement[]>();
  for (const s of (settles ?? []) as PeriodSettlement[]) {
    const arr = byOwner.get(s.owner_id) ?? [];
    arr.push(s);
    byOwner.set(s.owner_id, arr);
  }

  return (owners ?? []).map((o) => ({
    owner: o,
    units: unitCount.get(o.id) ?? 0,
    settlements: byOwner.get(o.id) ?? [],
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

  const { data: prev } = await admin
    .from("owner_settlements")
    .select("status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!prev) throw new Error("Liquidación no encontrada");

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status,
    last_edited_by: session.userId,
    last_edited_at: now,
    updated_at: now,
  };
  if (status === "revisada") {
    update.reviewed_at = now;
    update.reviewed_by = session.userId;
  }
  if (status === "enviada") update.sent_at = now;
  if (status === "pagada") {
    update.paid_at = now;
    if (paidMovementId) update.paid_movement_id = paidMovementId;
  }
  const { error } = await admin
    .from("owner_settlements")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  if (prev.status !== status) {
    await admin.from("settlement_audit").insert({
      organization_id: organization.id,
      settlement_id: id,
      action: "status_change",
      actor_user_id: session.userId,
      actor_name: actorNameOf(session),
      changes: { status: { from: prev.status, to: status } },
      side_effects: [],
    });
  }
  revalidateSettlement(id);
}

/**
 * Elimina definitivamente una liquidación. El borrado en cascada se lleva sus
 * settlement_lines y settlement_audit. Bloqueada si está pagada: dejaría
 * huérfano el egreso (y los ajustes) en Caja. Libera los tickets de
 * mantenimiento cobrados para que puedan volver a liquidarse.
 */
export async function deleteSettlement(settlementId: string) {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "settlements", "delete")) {
    throw new Error("No tenés permisos para eliminar liquidaciones");
  }
  const id = z.string().uuid().parse(settlementId);
  const admin = createAdminClient();

  const { data: s } = await admin
    .from("owner_settlements")
    .select("id, status, paid_movement_id")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!s) throw new Error("Liquidación no encontrada");
  if (s.status === "pagada" || s.paid_movement_id) {
    throw new Error(
      "No se puede eliminar una liquidación pagada. Anulá primero el pago en Caja.",
    );
  }

  // Liberar los tickets de mantenimiento cobrados a esta liquidación: sin esto
  // quedarían marcados como "ya cobrados" y no volverían a ninguna liquidación.
  await admin
    .from("maintenance_tickets")
    .update({ charged_to_owner_at: null, charged_to_settlement_id: null })
    .eq("charged_to_settlement_id", id);

  const { error } = await admin
    .from("owner_settlements")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  revalidateSettlement();
  return { ok: true as const };
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
      "El neto por pagar no es positivo: no se puede registrar el pago",
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
      last_edited_by: session.userId,
      last_edited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", v.settlement_id)
    .eq("organization_id", organization.id);
  if (updErr) {
    // Compensación: que el movimiento no quede huérfano
    await admin.from("cash_movements").delete().eq("id", movement.id);
    throw new Error(`No se pudo cerrar la liquidación: ${updErr.message}`);
  }

  await admin.from("settlement_audit").insert({
    organization_id: organization.id,
    settlement_id: v.settlement_id,
    action: "payment",
    actor_user_id: session.userId,
    actor_name: actorNameOf(session),
    changes: {
      status: { from: settlement.status, to: "pagada" },
      amount,
    },
    side_effects: [
      `Egreso en Caja ${formatMoney(amount, settlement.currency)} (${account.name})`,
    ],
  });

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
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.1em">Neto por pagar</div>
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
    `Neto por pagar: ${net}`,
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
