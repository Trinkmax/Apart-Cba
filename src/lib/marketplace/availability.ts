import { createAdminClient } from "@/lib/supabase/server";

export type AvailabilityCheck = {
  available: boolean;
  reason: string | null;
};

/**
 * Verifica que [checkIn, checkOut) esté libre para una unidad.
 * "Libre" = sin bookings activos (confirmada / check_in) que solapen,
 * y sin booking_requests pendientes vigentes que solapen.
 *
 * Esta es la verificación pre-creación. La definitiva la hace el constraint
 * `bookings_no_overlap` cuando insertamos.
 */
export async function checkUnitAvailability(params: {
  unitId: string;
  checkInIso: string;
  checkOutIso: string;
  excludeRequestId?: string;
}): Promise<AvailabilityCheck> {
  if (params.checkOutIso <= params.checkInIso) {
    return { available: false, reason: "Las fechas son inválidas" };
  }
  const admin = createAdminClient();

  // 1) Conflictos con bookings activos
  const { data: bookingConflicts, error: bkErr } = await admin
    .from("bookings")
    .select("id")
    .eq("unit_id", params.unitId)
    .in("status", ["confirmada", "check_in"])
    .lt("check_in_date", params.checkOutIso)
    .gt("check_out_date", params.checkInIso)
    .limit(1);

  if (bkErr) {
    return { available: false, reason: `Error verificando reservas: ${bkErr.message}` };
  }
  if ((bookingConflicts ?? []).length > 0) {
    return { available: false, reason: "Esas fechas ya están reservadas" };
  }

  // 2) Conflictos con booking_requests pendientes que aún no expiraron
  const nowIso = new Date().toISOString();
  let pendingQuery = admin
    .from("booking_requests")
    .select("id")
    .eq("unit_id", params.unitId)
    .eq("status", "pendiente")
    .gt("expires_at", nowIso)
    .lt("check_in_date", params.checkOutIso)
    .gt("check_out_date", params.checkInIso);

  if (params.excludeRequestId) {
    pendingQuery = pendingQuery.neq("id", params.excludeRequestId);
  }

  const { data: pendingConflicts, error: pendErr } = await pendingQuery.limit(1);
  if (pendErr) {
    return { available: false, reason: `Error verificando solicitudes: ${pendErr.message}` };
  }
  if ((pendingConflicts ?? []).length > 0) {
    return {
      available: false,
      reason: "Hay una solicitud pendiente para esas fechas. Probá con otras o esperá unas horas.",
    };
  }

  return { available: true, reason: null };
}

/**
 * Devuelve las fechas bloqueadas (YYYY-MM-DD) para una unidad en un rango
 * dado. Se usa en el date picker del marketplace para deshabilitar fechas.
 */
export async function getBlockedDates(params: {
  unitId: string;
  fromIso: string;
  toIso: string;
}): Promise<string[]> {
  const admin = createAdminClient();
  const [bookingsRes, requestsRes] = await Promise.all([
    admin
      .from("bookings")
      .select("check_in_date, check_out_date")
      .eq("unit_id", params.unitId)
      .in("status", ["confirmada", "check_in"])
      .lt("check_in_date", params.toIso)
      .gt("check_out_date", params.fromIso),
    admin
      .from("booking_requests")
      .select("check_in_date, check_out_date")
      .eq("unit_id", params.unitId)
      .eq("status", "pendiente")
      .gt("expires_at", new Date().toISOString())
      .lt("check_in_date", params.toIso)
      .gt("check_out_date", params.fromIso),
  ]);

  const ranges: { start: string; end: string }[] = [];
  for (const b of bookingsRes.data ?? []) {
    ranges.push({ start: b.check_in_date, end: b.check_out_date });
  }
  for (const r of requestsRes.data ?? []) {
    ranges.push({ start: r.check_in_date, end: r.check_out_date });
  }

  const blocked = new Set<string>();
  for (const r of ranges) {
    let cursor = r.start;
    let safety = 0;
    while (cursor < r.end && safety < 365 * 2) {
      blocked.add(cursor);
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
      safety++;
    }
  }
  return Array.from(blocked).sort();
}
