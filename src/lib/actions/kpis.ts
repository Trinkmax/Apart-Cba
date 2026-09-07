"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import {
  addDaysYmd,
  dayRangeInTz,
  todayYmdInTz,
  ymdInTz,
  DEFAULT_ORG_TIMEZONE,
  completionCutoffYmd,
} from "@/lib/dates";

/**
 * Categorías de Caja que son plata del huésped. Se filtra por categoría y
 * NUNCA por ref_type/billable_to: los movimientos cargados a mano desde Caja
 * entran con ref_type NULL y las filas editadas pueden tener billable_to
 * 'apartcba'/'guest'. Quedan afuera owner_settlement (puede ser 'in' en un
 * ajuste), transfer, maintenance y el resto.
 *
 * El signo sale SÓLO de `direction`, igual que el saldo de la cuenta y el
 * sync de paid_amount (RPCs de la 007): el formulario deja combinar cualquier
 * categoría con Ingreso/Egreso, así que una devolución cargada como
 * "Cobro de reserva · Egreso" tiene que restar acá también.
 */
const GUEST_CASH_CATEGORIES = ["booking_payment", "extra_charge", "refund"] as const;

/**
 * PostgREST corta en 1000 filas (max-rows de Supabase) sin avisar y un
 * `.limit()` mayor no lo pasa. Hoy son ~200 filas/30 días en la org más
 * grande, pero crece con la granularidad de los cobros: paginamos por
 * `.range()` — una sola request en el caso normal — con un techo para no
 * colgar el inicio si alguna vez explota.
 */
const CASH_PAGE_SIZE = 1000;
const CASH_MAX_PAGES = 10;

type GuestCashRow = { amount: number; currency: string; direction: string; occurred_at: string };

async function fetchGuestCash(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  fromIso: string,
  toIso: string
): Promise<GuestCashRow[]> {
  const rows: GuestCashRow[] = [];
  for (let page = 0; page < CASH_MAX_PAGES; page++) {
    const from = page * CASH_PAGE_SIZE;
    const { data, error } = await admin
      .from("cash_movements")
      .select("amount, currency, direction, occurred_at")
      .eq("organization_id", organizationId)
      .in("category", [...GUEST_CASH_CATEGORIES])
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      // Orden estable para que las páginas no se pisen ni salteen filas.
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CASH_PAGE_SIZE - 1);
    if (error) {
      console.error("[kpis] cash_movements page", page, error.message);
      break;
    }
    rows.push(...((data ?? []) as GuestCashRow[]));
    if ((data?.length ?? 0) < CASH_PAGE_SIZE) return rows;
  }
  console.warn(
    `[kpis] cobrado 30d: más de ${CASH_PAGE_SIZE * CASH_MAX_PAGES} movimientos, la serie queda incompleta`
  );
  return rows;
}

export interface DashboardKPIs {
  totals: {
    units: number;
    available_units: number;
    occupied_units: number;
    cleaning_units: number;
    maintenance_units: number;
  };
  bookings: {
    upcoming_30d: number;
    today_check_ins: number;
    today_check_outs: number;
    nights_30d: number;
    /** Reservas de canal (Airbnb/Booking) sin huésped asignado — "Completar datos". */
    pending_guest_data: number;
    /**
     * Reservas de canal (Airbnb/Booking) sin importe cargado, con check-out
     * entre hoy−30 y hoy+30. El iCal no trae precio: hasta que alguien lo
     * cargue, el resultado del mes y la liquidación quedan incompletos.
     */
    pending_price: number;
  };
  finance: {
    /** Importe contratado (bookings.total_amount) con check-out en ±30 días. */
    revenue_30d_by_currency: Record<string, number>;
    pending_payment_by_currency: Record<string, number>;
    /**
     * Lo que entró en Caja por reservas y cobros extra (menos devoluciones)
     * en los últimos 30 días, por moneda. Es la plata real: una reserva de
     * Booking con total 0 igual aparece acá cuando se le registra el cobro.
     */
    collected_30d_by_currency: Record<string, number>;
  };
  service: {
    open_tickets: number;
    urgent_tickets: number;
    cleaning_pending: number;
    concierge_pending: number;
  };
  occupancy_pct_30d: number;
  next_check_ins: Array<{
    id: string;
    check_in_date: string;
    check_in_time: string;
    guest_name: string | null;
    unit_code: string;
    unit_name: string;
    guests_count: number;
  }>;
  next_check_outs: Array<{
    id: string;
    check_out_date: string;
    check_out_time: string;
    guest_name: string | null;
    unit_code: string;
    unit_name: string;
  }>;
  /** Serie diaria (30 días): `amount` = reservado por check-in, `collected` = cobrado en Caja. */
  daily_revenue_30d: Array<{ date: string; amount: number; collected: number; currency: string }>;
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  // "Hoy" es el de la organización, no el del proceso. Vercel corre en UTC:
  // desde las 21:00 en Argentina el UTC ya es mañana, así que "Próximos
  // check-in" y la ocupación se corrían un día justo en la franja en que
  // recepción está cargando reservas.
  const tz = organization.timezone || DEFAULT_ORG_TIMEZONE;
  const todayStr = todayYmdInTz(tz);
  const in30Str = addDaysYmd(todayStr, 30);
  const back30Str = addDaysYmd(todayStr, -30);
  const completionCutoff = completionCutoffYmd(tz);
  // Ventana de Caja: los 30 días que dibuja el chart (hoy−29 … hoy), como
  // rango [inicio, fin) en UTC del día LOCAL. occurred_at es timestamptz y
  // el proceso corre en UTC: un cobro de las 22:00 en Córdoba ya es "mañana"
  // en UTC, así que ni el rango ni el bucket pueden salir de un slice del ISO.
  const cashFromIso = dayRangeInTz(addDaysYmd(todayStr, -29), tz).startIso;
  const cashToIso = dayRangeInTz(todayStr, tz).endIso;
  // El chart es mono-moneda: usa la de la org (antes ARS fijo).
  const chartCurrency = organization.default_currency || "ARS";

  const bookingFields =
    "id, status, currency, total_amount, paid_amount, check_in_date, check_in_time, check_out_date, check_out_time, guests_count, unit:units(code, name), guest:guests(full_name)";

  const [
    { data: units },
    { data: bookings30 },
    { data: bookingsAll },
    { count: openTicketsCount },
    { count: urgentTicketsCount },
    { count: cleaningPendingCount },
    { count: conciergePendingCount },
    { count: pendingGuestCount },
    guestCash,
    { count: pendingPriceCount },
  ] = await Promise.all([
    admin.from("units").select("id, status").eq("organization_id", organization.id).eq("active", true),
    admin
      .from("bookings")
      .select(bookingFields)
      .eq("organization_id", organization.id)
      .gte("check_in_date", todayStr)
      .lte("check_in_date", in30Str)
      .in("status", ["confirmada", "check_in"])
      .eq("is_block", false) // los bloqueos OTA no cuentan como ocupación/reservas
      .order("check_in_date"),
    admin
      .from("bookings")
      .select(bookingFields)
      .eq("organization_id", organization.id)
      .gte("check_out_date", back30Str)
      .lte("check_out_date", in30Str)
      .eq("is_block", false), // los bloqueos OTA no cuentan como reservas/check-outs
    admin
      .from("maintenance_tickets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .not("status", "in", "(resuelto,cerrado)"),
    admin
      .from("maintenance_tickets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("priority", "urgente")
      .not("status", "in", "(resuelto,cerrado)"),
    admin
      .from("cleaning_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .in("status", ["pendiente", "en_progreso"]),
    admin
      .from("concierge_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .in("status", ["pendiente", "en_progreso"]),
    // Reservas de OTA sin huésped. Misma cota que el panel "Por completar"
    // del tablero (listBookingsNeedingCompletion): desde el mes pasado. Así el
    // número del dashboard y las filas del panel son exactamente el mismo set.
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .is("guest_id", null)
      .eq("is_block", false)
      .in("source", ["airbnb", "booking"])
      .in("status", ["pendiente", "confirmada", "check_in", "check_out"])
      .gte("check_out_date", completionCutoff),
    // Plata del huésped que entró en Caja en los últimos 30 días (ver
    // GUEST_CASH_CATEGORIES). Usa idx_movements_org_date.
    fetchGuestCash(admin, organization.id, cashFromIso, cashToIso),
    // Reservas de OTA sin precio (misma regla que el badge "Sin precio" del
    // listado: total <= 0, no cancelada, no bloqueo), con la misma cota.
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.id)
      .eq("is_block", false)
      .in("source", ["airbnb", "booking"])
      .in("status", ["pendiente", "confirmada", "check_in", "check_out"])
      .lte("total_amount", 0)
      .gte("check_out_date", completionCutoff),
  ]);

  const totals = {
    units: units?.length ?? 0,
    available_units: units?.filter((u) => u.status === "disponible").length ?? 0,
    occupied_units: units?.filter((u) => u.status === "ocupado").length ?? 0,
    cleaning_units: units?.filter((u) => u.status === "limpieza").length ?? 0,
    maintenance_units: units?.filter((u) => u.status === "mantenimiento").length ?? 0,
  };

  const todayCheckIns = bookings30?.filter((b) => b.check_in_date === todayStr).length ?? 0;
  const todayCheckOuts = bookingsAll?.filter((b) => b.check_out_date === todayStr).length ?? 0;

  const nights30 = (bookings30 ?? []).reduce((acc, b) => {
    const ci = new Date(b.check_in_date);
    const co = new Date(b.check_out_date);
    return acc + Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
  }, 0);

  const totalNightsPossible = (units?.length ?? 1) * 30;
  const occupancy = totalNightsPossible > 0 ? (nights30 / totalNightsPossible) * 100 : 0;

  // Revenue last 30d by currency (bookings closed in period)
  const revenueByCurrency: Record<string, number> = {};
  const pendingByCurrency: Record<string, number> = {};
  const dailyRevenue: Map<string, { amount: number; currency: string }[]> = new Map();

  (bookingsAll ?? []).forEach((b) => {
    if (["check_out", "check_in", "confirmada"].includes(b.status)) {
      revenueByCurrency[b.currency] = (revenueByCurrency[b.currency] ?? 0) + Number(b.total_amount);
      const pendingAmt = Math.max(0, Number(b.total_amount) - Number(b.paid_amount));
      if (pendingAmt > 0) {
        pendingByCurrency[b.currency] = (pendingByCurrency[b.currency] ?? 0) + pendingAmt;
      }
      const dayKey = b.check_in_date.slice(0, 10);
      const arr = dailyRevenue.get(dayKey) ?? [];
      arr.push({ amount: Number(b.total_amount), currency: b.currency });
      dailyRevenue.set(dayKey, arr);
    }
  });

  // Cobrado en Caja: neto de devoluciones, por moneda y por día local. El
  // signo es el de la dirección, como en el saldo de la cuenta.
  const collectedByCurrency: Record<string, number> = {};
  const dailyCollected = new Map<string, Record<string, number>>();
  for (const m of guestCash) {
    const signed = m.direction === "in" ? Number(m.amount) : -Number(m.amount);
    collectedByCurrency[m.currency] = (collectedByCurrency[m.currency] ?? 0) + signed;
    const dayKey = ymdInTz(new Date(m.occurred_at), tz);
    const perCur = dailyCollected.get(dayKey) ?? {};
    perCur[m.currency] = (perCur[m.currency] ?? 0) + signed;
    dailyCollected.set(dayKey, perCur);
  }

  // Daily series para chart (una sola moneda para no mezclar)
  const dailySeries: DashboardKPIs["daily_revenue_30d"] = [];
  for (let i = 29; i >= 0; i--) {
    const k = addDaysYmd(todayStr, -i);
    const items = dailyRevenue.get(k) ?? [];
    const reserved = items
      .filter((x) => x.currency === chartCurrency)
      .reduce((a, b) => a + b.amount, 0);
    const collected = dailyCollected.get(k)?.[chartCurrency] ?? 0;
    dailySeries.push({ date: k, amount: reserved, collected, currency: chartCurrency });
  }

  const openTickets = openTicketsCount ?? 0;
  const urgentTickets = urgentTicketsCount ?? 0;
  const cleaningPending = cleaningPendingCount ?? 0;
  const conciergePending = conciergePendingCount ?? 0;

  const upcoming = (bookings30 ?? []).slice(0, 5).map((b) => ({
    id: b.id,
    check_in_date: b.check_in_date,
    check_in_time: b.check_in_time,
    guest_name: (b.guest as unknown as { full_name?: string })?.full_name ?? null,
    unit_code: (b.unit as unknown as { code: string }).code,
    unit_name: (b.unit as unknown as { name: string }).name,
    guests_count: b.guests_count,
  }));

  const checkOutsList = (bookingsAll ?? [])
    .filter((b) => b.check_out_date >= todayStr && ["confirmada", "check_in"].includes(b.status))
    .sort((a, b) => a.check_out_date.localeCompare(b.check_out_date))
    .slice(0, 5)
    .map((b) => ({
      id: b.id,
      check_out_date: b.check_out_date,
      check_out_time: b.check_out_time,
      guest_name: (b.guest as unknown as { full_name?: string })?.full_name ?? null,
      unit_code: (b.unit as unknown as { code: string }).code,
      unit_name: (b.unit as unknown as { name: string }).name,
    }));

  return {
    totals,
    bookings: {
      upcoming_30d: bookings30?.length ?? 0,
      today_check_ins: todayCheckIns,
      today_check_outs: todayCheckOuts,
      nights_30d: nights30,
      pending_guest_data: pendingGuestCount ?? 0,
      pending_price: pendingPriceCount ?? 0,
    },
    finance: {
      revenue_30d_by_currency: revenueByCurrency,
      pending_payment_by_currency: pendingByCurrency,
      collected_30d_by_currency: collectedByCurrency,
    },
    service: {
      open_tickets: openTickets,
      urgent_tickets: urgentTickets,
      cleaning_pending: cleaningPending,
      concierge_pending: conciergePending,
    },
    occupancy_pct_30d: occupancy,
    next_check_ins: upcoming,
    next_check_outs: checkOutsList,
    daily_revenue_30d: dailySeries,
  };
}
