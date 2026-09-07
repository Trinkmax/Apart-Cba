"use server";

/**
 * Resultados del mes — "qué entra, qué se lleva cada uno y qué le queda a cada
 * propietario". Es la respuesta a la pregunta de toda inmobiliaria chica:
 * "¿dónde veo cuánto tengo que pagar a los propietarios, cuánto cobro yo y
 * cuánto se llevan las plataformas?".
 *
 * Es SOLO LECTURA: no escribe nada, no genera liquidaciones. Reusa las mismas
 * reglas que la liquidación (src/lib/actions/settlements.ts) para que los
 * números coincidan con lo que después se le manda al propietario:
 *   • temporario → se cuenta en el mes del CHECK-OUT;
 *   • mensual    → se prorratea la renta por los días del mes;
 *   • % de administración → acuerdo con el dueño en la unidad, si no la política
 *     por canal de venta, si no el de la unidad, si no el de la org, si no 20
 *     (resolveCommissionPct, migración 059);
 *   • los importes salen de src/lib/finance/booking-economics.ts.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import {
  computeBookingEconomics,
  channelCommissionPctFor,
  resolveCommissionPct,
  round2,
  type CommissionBase,
} from "@/lib/finance/booking-economics";
import type { BookingSource, BookingStatus } from "@/lib/types/database";

const RESULT_BOOKING_STATUSES = ["pendiente", "confirmada", "check_in", "check_out"] as const;

export interface ResultBookingRow {
  booking_id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  guest_name: string | null;
  source: BookingSource;
  status: BookingStatus;
  mode: "temporario" | "mensual";
  check_in_date: string;
  check_out_date: string;
  nights: number;
  currency: string;
  /** Lo que paga el huésped (en mensual: renta prorrateada del mes). */
  total: number;
  cleaning: number;
  channel_pct: number;
  channel_commission: number;
  /** % efectivo de administración (promedio ponderado si hay co-dueños con % distinto). */
  commission_pct: number;
  commission: number;
  owner_net: number;
  paid: number;
  pending: number;
  /** true si la reserva no tiene importe cargado (OTA por iCal). El resultado está incompleto. */
  missing_price: boolean;
  owners: Array<{ owner_id: string | null; owner_name: string; share_pct: number; net: number }>;
  /** Días del mes que ocupa (sólo mensual). */
  prorate?: { days: number; of: number } | null;
}

export interface ResultTotals {
  currency: string;
  bookings: number;
  total: number;
  cleaning: number;
  channel_commission: number;
  commission: number;
  owner_net: number;
  paid: number;
  pending: number;
}

export interface ResultByChannel extends ResultTotals {
  source: BookingSource;
  /** % promedio ponderado que se llevó el canal. */
  channel_pct_effective: number;
}

export interface ResultByOwner extends ResultTotals {
  owner_id: string | null;
  owner_name: string;
  unit_codes: string[];
  settlement: {
    id: string;
    status: string;
    net_payable: number;
    currency: string;
  } | null;
}

export interface MonthlyResults {
  year: number;
  month: number;
  commission_base: CommissionBase;
  /** Mapa canal → % configurado en la org (para explicar de dónde sale cada número). */
  channel_commissions: Partial<Record<BookingSource, number>>;
  /** Canales con reservas en el mes pero sin % configurado. */
  channels_without_pct: BookingSource[];
  rows: ResultBookingRow[];
  totals: ResultTotals[];
  by_channel: ResultByChannel[];
  by_owner: ResultByOwner[];
  missing_price_count: number;
  units_without_owner: Array<{ unit_id: string; code: string; name: string }>;
}

function dayDiff(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00").getTime();
  const b = new Date(toISO + "T12:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type UnitOwnerLite = {
  unit_id: string;
  owner_id: string;
  ownership_pct: number | null;
  commission_pct_override: number | null;
  is_primary: boolean | null;
};

export async function getMonthlyResults(year: number, month: number): Promise<MonthlyResults> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Sólo quien ve la plata de la organización (admin/recepción). `settlements.view`
  // no alcanza: owner_view lo tiene para mirar SUS liquidaciones, y acá se ven
  // los números de todos los propietarios y la comisión de la administración.
  if (!can(role, "payments", "view")) {
    throw new Error("No tenés permiso para ver los resultados");
  }
  const admin = createAdminClient();

  // Defensa propia además de la del page: un año fuera de rango arma un
  // literal de fecha inválido y PostgREST devuelve 22007.
  const currentYear = new Date().getUTCFullYear();
  const y = Number.isFinite(year)
    ? Math.min(currentYear + 5, Math.max(2000, Math.trunc(year)))
    : currentYear;
  const m = Number.isFinite(month) ? Math.min(12, Math.max(1, Math.trunc(month))) : 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const periodStart = ymd(y, m, 1);
  const periodEnd = ymd(y, m, daysInMonth);

  const commissionBase: CommissionBase = organization.commission_base ?? "net_of_channel";
  const channelMap = organization.channel_commissions ?? {};
  // Comisión de administración por canal (migración 059). Misma cascada que la
  // liquidación: acuerdo con el propietario → canal → unidad → org → 20.
  const commissionBySource = organization.commission_by_source ?? {};

  const [{ data: bookings, error: bErr }, { data: units, error: uErr }, { data: settlements }] =
    await Promise.all([
      admin
        .from("bookings")
        .select(
          "id, unit_id, source, status, mode, check_in_date, check_out_date, currency, total_amount, paid_amount, commission_pct, cleaning_fee, channel_commission_pct, monthly_rent, guest:guests(full_name)"
        )
        .eq("organization_id", organization.id)
        .eq("is_block", false)
        .in("status", RESULT_BOOKING_STATUSES as unknown as string[])
        .lte("check_in_date", periodEnd)
        .gte("check_out_date", periodStart)
        .order("check_out_date"),
      admin
        .from("units")
        .select(
          "id, code, name, default_commission_pct, unit_owners(unit_id, owner_id, ownership_pct, commission_pct_override, is_primary, owner:owners(id, full_name))"
        )
        .eq("organization_id", organization.id),
      admin
        .from("owner_settlements")
        .select("id, owner_id, status, net_payable, currency")
        .eq("organization_id", organization.id)
        .eq("period_year", y)
        .eq("period_month", m)
        .neq("status", "anulada"),
    ]);
  if (bErr) throw new Error(bErr.message);
  if (uErr) throw new Error(uErr.message);

  type UnitRow = {
    id: string;
    code: string;
    name: string;
    default_commission_pct: number | null;
    unit_owners: Array<UnitOwnerLite & { owner: { id: string; full_name: string } | null }> | null;
  };
  const unitById = new Map<string, UnitRow>();
  for (const u of (units ?? []) as unknown as UnitRow[]) unitById.set(u.id, u);

  const settlementByOwner = new Map<string, ResultByOwner["settlement"]>();
  for (const s of settlements ?? []) {
    // Si hay más de una (multi-moneda), preferimos la no-borrador; a igualdad, la primera.
    const prev = settlementByOwner.get(s.owner_id as string);
    const next = {
      id: s.id as string,
      status: s.status as string,
      net_payable: Number(s.net_payable),
      currency: s.currency as string,
    };
    if (!prev || (prev.status === "borrador" && next.status !== "borrador")) {
      settlementByOwner.set(s.owner_id as string, next);
    }
  }

  const rows: ResultBookingRow[] = [];
  const channelsWithoutPct = new Set<BookingSource>();

  for (const b of bookings ?? []) {
    const unit = unitById.get(b.unit_id as string);
    const mode = ((b.mode as string | null) ?? "temporario") as "temporario" | "mensual";
    const source = b.source as BookingSource;
    const currency = (b.currency as string | null) ?? organization.default_currency ?? "ARS";
    const guestName =
      (b.guest as unknown as { full_name?: string } | null)?.full_name ?? null;

    // Base imponible del mes según el modo (mismas reglas que la liquidación).
    let total: number;
    let cleaning: number;
    let prorate: ResultBookingRow["prorate"] = null;
    if (mode === "mensual") {
      const overlapStart =
        (b.check_in_date as string) > periodStart ? (b.check_in_date as string) : periodStart;
      const overlapEnd =
        (b.check_out_date as string) < periodEnd ? (b.check_out_date as string) : periodEnd;
      const occupiedDays = dayDiff(overlapStart, overlapEnd);
      if (occupiedDays === 0) continue;
      const monthlyRent = Number(b.monthly_rent ?? 0);
      total = round2((monthlyRent / daysInMonth) * occupiedDays);
      cleaning = 0;
      prorate = { days: occupiedDays, of: daysInMonth };
    } else {
      // Temporario: cuenta en el mes del check-out.
      if ((b.check_out_date as string) < periodStart || (b.check_out_date as string) > periodEnd) {
        continue;
      }
      total = Number(b.total_amount ?? 0);
      cleaning = Number(b.cleaning_fee ?? 0);
    }

    // La comisión de canal aplica sólo a temporarias: las OTAs no venden
    // contratos mensuales, y la renta prorrateada no es "lo que pagó el
    // huésped por la plataforma".
    const channelPct =
      mode === "mensual"
        ? 0
        : b.channel_commission_pct !== null && b.channel_commission_pct !== undefined
          ? Number(b.channel_commission_pct)
          : channelCommissionPctFor(channelMap, source);
    if (
      mode !== "mensual" &&
      channelPct === 0 &&
      source !== "directo" &&
      source !== "whatsapp" &&
      source !== "instagram" &&
      source !== "otro" &&
      (channelMap[source] === undefined || channelMap[source] === null)
    ) {
      channelsWithoutPct.add(source);
    }

    // Dueños de la unidad: cada uno con su participación y su % de comisión.
    const unitOwners = (unit?.unit_owners ?? []).filter((uo) => uo.owner_id);
    const ownerEntries: ResultBookingRow["owners"] = [];
    let commissionSum = 0;
    let channelSum = 0;
    let ownerNetSum = 0;
    let cleaningSum = 0;
    let weightedPct = 0;

    if (unitOwners.length === 0) {
      const pct = resolveCommissionPct({
        source,
        bySource: commissionBySource,
        unitPct: unit?.default_commission_pct,
        orgPct: organization.default_commission_pct,
      }).pct;
      const eco = computeBookingEconomics({
        total,
        cleaningFee: cleaning,
        channelPct,
        commissionPct: pct,
        commissionBase,
      });
      commissionSum = eco.commission;
      channelSum = eco.channelCommission;
      ownerNetSum = eco.ownerNet;
      cleaningSum = eco.cleaning;
      weightedPct = pct;
      ownerEntries.push({
        owner_id: null,
        owner_name: "Sin propietario asignado",
        share_pct: 100,
        net: eco.ownerNet,
      });
    } else {
      // Normalizamos las participaciones por si no suman 100 (dato cargado a mano).
      const sharesTotal = unitOwners.reduce((a, uo) => a + Number(uo.ownership_pct ?? 100), 0) || 100;
      for (const uo of unitOwners) {
        const share = Number(uo.ownership_pct ?? 100) / sharesTotal;
        const pct = resolveCommissionPct({
          source,
          ownerOverride: uo.commission_pct_override,
          bySource: commissionBySource,
          unitPct: unit?.default_commission_pct,
          orgPct: organization.default_commission_pct,
        }).pct;
        const eco = computeBookingEconomics({
          total,
          cleaningFee: cleaning,
          channelPct,
          commissionPct: pct,
          commissionBase,
          ownerShare: share,
        });
        commissionSum += eco.commission;
        channelSum += eco.channelCommission;
        ownerNetSum += eco.ownerNet;
        cleaningSum += eco.cleaning;
        weightedPct += pct * share;
        ownerEntries.push({
          owner_id: uo.owner_id,
          owner_name: uo.owner?.full_name ?? "Propietario",
          share_pct: round2(share * 100),
          net: eco.ownerNet,
        });
      }
    }

    const paid = Number(b.paid_amount ?? 0);
    // Sin precio cargado no hay nada que repartir: contar la limpieza como
    // neto negativo distorsionaría los totales. La fila queda marcada
    // (`missing_price`) y el banner de la página explica que falta cargarlo.
    if (total <= 0) {
      commissionSum = 0;
      channelSum = 0;
      ownerNetSum = 0;
      cleaningSum = 0;
      for (const o of ownerEntries) o.net = 0;
    }
    rows.push({
      booking_id: b.id as string,
      unit_id: b.unit_id as string,
      unit_code: unit?.code ?? "—",
      unit_name: unit?.name ?? "—",
      guest_name: guestName,
      source,
      status: b.status as BookingStatus,
      mode,
      check_in_date: b.check_in_date as string,
      check_out_date: b.check_out_date as string,
      nights: dayDiff(b.check_in_date as string, b.check_out_date as string),
      currency,
      total: round2(total),
      cleaning: round2(cleaningSum),
      channel_pct: channelPct,
      channel_commission: round2(channelSum),
      commission_pct: round2(weightedPct),
      commission: round2(commissionSum),
      owner_net: round2(ownerNetSum),
      paid: round2(paid),
      pending: round2(Math.max(0, total - paid)),
      missing_price: total <= 0,
      owners: ownerEntries,
      prorate,
    });
  }

  // ── Agregados ──────────────────────────────────────────────────────────────
  const emptyTotals = (currency: string): ResultTotals => ({
    currency,
    bookings: 0,
    total: 0,
    cleaning: 0,
    channel_commission: 0,
    commission: 0,
    owner_net: 0,
    paid: 0,
    pending: 0,
  });
  const add = (t: ResultTotals, r: ResultBookingRow) => {
    t.bookings += 1;
    t.total = round2(t.total + r.total);
    t.cleaning = round2(t.cleaning + r.cleaning);
    t.channel_commission = round2(t.channel_commission + r.channel_commission);
    t.commission = round2(t.commission + r.commission);
    t.owner_net = round2(t.owner_net + r.owner_net);
    t.paid = round2(t.paid + r.paid);
    t.pending = round2(t.pending + r.pending);
  };

  const totalsByCur = new Map<string, ResultTotals>();
  const byChannel = new Map<string, ResultByChannel & { _w: number }>();
  const byOwner = new Map<string, ResultByOwner & { _units: Set<string> }>();

  for (const r of rows) {
    const t = totalsByCur.get(r.currency) ?? emptyTotals(r.currency);
    add(t, r);
    totalsByCur.set(r.currency, t);

    const ck = `${r.source}|${r.currency}`;
    const c =
      byChannel.get(ck) ??
      ({ ...emptyTotals(r.currency), source: r.source, channel_pct_effective: 0, _w: 0 } as ResultByChannel & {
        _w: number;
      });
    add(c, r);
    c._w += r.channel_pct * r.total;
    byChannel.set(ck, c);

    for (const o of r.owners) {
      const ok = `${o.owner_id ?? "none"}|${r.currency}`;
      const ow =
        byOwner.get(ok) ??
        ({
          ...emptyTotals(r.currency),
          owner_id: o.owner_id,
          owner_name: o.owner_name,
          unit_codes: [],
          settlement: o.owner_id ? settlementByOwner.get(o.owner_id) ?? null : null,
          _units: new Set<string>(),
        } as ResultByOwner & { _units: Set<string> });
      const share = o.share_pct / 100;
      ow.bookings += 1;
      ow.total = round2(ow.total + r.total * share);
      ow.cleaning = round2(ow.cleaning + r.cleaning * share);
      ow.channel_commission = round2(ow.channel_commission + r.channel_commission * share);
      ow.commission = round2(ow.commission + r.commission * share);
      ow.owner_net = round2(ow.owner_net + o.net);
      ow.paid = round2(ow.paid + r.paid * share);
      ow.pending = round2(ow.pending + r.pending * share);
      ow._units.add(r.unit_code);
      byOwner.set(ok, ow);
    }
  }

  const unitsWithoutOwner = Array.from(unitById.values())
    .filter((u) => (u.unit_owners ?? []).length === 0)
    .map((u) => ({ unit_id: u.id, code: u.code, name: u.name }));

  return {
    year: y,
    month: m,
    commission_base: commissionBase,
    channel_commissions: channelMap,
    channels_without_pct: Array.from(channelsWithoutPct),
    rows,
    totals: Array.from(totalsByCur.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
    by_channel: Array.from(byChannel.values())
      .map(({ _w, ...c }) => ({
        ...c,
        channel_pct_effective: c.total > 0 ? round2(_w / c.total) : 0,
      }))
      .sort((a, b) => b.total - a.total),
    by_owner: Array.from(byOwner.values())
      .map(({ _units, ...o }) => ({ ...o, unit_codes: Array.from(_units).sort() }))
      .sort((a, b) => b.owner_net - a.owner_net),
    missing_price_count: rows.filter((r) => r.missing_price).length,
    units_without_owner: unitsWithoutOwner,
  };
}
