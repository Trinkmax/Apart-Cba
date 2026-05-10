"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";

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
  };
  finance: {
    revenue_30d_by_currency: Record<string, number>;
    pending_payment_by_currency: Record<string, number>;
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
  daily_revenue_30d: Array<{ date: string; amount: number; currency: string }>;
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const in30 = new Date(today);
  in30.setDate(today.getDate() + 30);
  const back30 = new Date(today);
  back30.setDate(today.getDate() - 30);
  const in30Str = in30.toISOString().slice(0, 10);
  const back30Str = back30.toISOString().slice(0, 10);

  const bookingFields =
    "id, status, currency, total_amount, paid_amount, check_in_date, check_in_time, check_out_date, check_out_time, guests_count, unit:units(code, name), guest:guests(full_name)";

  const [
    { data: units },
    { data: bookings30 },
    { data: bookingsAll },
    { data: tickets },
    { data: cleanings },
    { data: concierges },
  ] = await Promise.all([
    admin.from("units").select("id, status").eq("organization_id", organization.id).eq("active", true),
    admin
      .from("bookings")
      .select(bookingFields)
      .eq("organization_id", organization.id)
      .gte("check_in_date", todayStr)
      .lte("check_in_date", in30Str)
      .in("status", ["confirmada", "check_in"])
      .order("check_in_date"),
    admin
      .from("bookings")
      .select(bookingFields)
      .eq("organization_id", organization.id)
      .gte("check_out_date", back30Str)
      .lte("check_out_date", in30Str),
    admin
      .from("maintenance_tickets")
      .select("id, status, priority")
      .eq("organization_id", organization.id),
    admin
      .from("cleaning_tasks")
      .select("id, status")
      .eq("organization_id", organization.id),
    admin
      .from("concierge_requests")
      .select("id, status")
      .eq("organization_id", organization.id),
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

  // Daily series para chart (solo ARS para no mezclar)
  const dailySeries: Array<{ date: string; amount: number; currency: string }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const items = dailyRevenue.get(k) ?? [];
    const arsTotal = items.filter((x) => x.currency === "ARS").reduce((a, b) => a + b.amount, 0);
    dailySeries.push({ date: k, amount: arsTotal, currency: "ARS" });
  }

  const openTickets = tickets?.filter((t) => !["resuelto", "cerrado"].includes(t.status)).length ?? 0;
  const urgentTickets = tickets?.filter((t) => t.priority === "urgente" && !["resuelto", "cerrado"].includes(t.status)).length ?? 0;
  const cleaningPending = cleanings?.filter((c) => ["pendiente", "en_progreso"].includes(c.status)).length ?? 0;
  const conciergePending = concierges?.filter((c) => ["pendiente", "en_progreso"].includes(c.status)).length ?? 0;

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
    },
    finance: {
      revenue_30d_by_currency: revenueByCurrency,
      pending_payment_by_currency: pendingByCurrency,
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
