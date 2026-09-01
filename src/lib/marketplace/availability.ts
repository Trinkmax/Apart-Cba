import {
  channelsHoldingAvailability,
  readChannelRequestPolicies,
} from "@/lib/channels/request-policy";
import { createAdminClient } from "@/lib/supabase/server";

export type AvailabilityCheck = {
  available: boolean;
  reason: string | null;
};

/**
 * Estados de `bookings` que ocupan el calendario a los ojos del marketplace.
 * DEBE coincidir con el `WHERE` de la exclusion constraint `bookings_no_overlap`
 * (migración 030): incluye 'pendiente' para que las retenciones que hace
 * recepción no se puedan revender por la web. Los bloqueos de "uso propietario"
 * y operacionales viajan como bookings con guest_id NULL / status 'confirmada',
 * así que también quedan cubiertos.
 */
export const OCCUPYING_BOOKING_STATUSES = ["pendiente", "confirmada", "check_in"] as const;

/**
 * Una solicitud sin señal de vida hace más de esto está huérfana (conexión
 * pausada o borrada: el dispatcher sólo ve links `active`) y deja de retener
 * fechas. Se mide con `last_seen_at` —que el dispatcher refresca al menos cada
 * hora para todo lo que la OTA sigue publicando— y no con `created_at`, que es
 * el alta y no prueba nada. Ninguna política retiene más de 26 h.
 */
const REQUEST_HOLD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Verifica que [checkIn, checkOut) esté libre para una unidad.
 * "Libre" = sin bookings que ocupen (ver OCCUPYING_BOOKING_STATUSES) que solapen,
 * y sin booking_requests pendientes vigentes que solapen.
 *
 * Esta es la verificación pre-creación. La definitiva la hacen los constraints
 * `bookings_no_overlap` / `booking_requests_no_overlap` cuando insertamos.
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
    .in("status", OCCUPYING_BOOKING_STATUSES as unknown as string[])
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

  // 3) Solicitudes de OTA sin confirmar, sólo de los canales cuya política
  //    retiene disponibilidad. Acá no hay ninguna persona a quien advertir: con
  //    instant_book el checkout inserta la reserva solo, así que o bloquea o
  //    hay venta doble.
  let otaHold: boolean;
  try {
    otaHold = await channelRequestOverlap(admin, {
      unitId: params.unitId,
      checkInIso: params.checkInIso,
      checkOutIso: params.checkOutIso,
    });
  } catch (err) {
    return {
      available: false,
      reason: `Error verificando solicitudes de canal: ${err instanceof Error ? err.message : "desconocido"}`,
    };
  }
  if (otaHold) {
    return {
      available: false,
      reason: "Hay una solicitud pendiente para esas fechas. Probá con otras o esperá unas horas.",
    };
  }

  return { available: true, reason: null };
}

/**
 * ¿Alguna solicitud de canal sin confirmar solapa estas fechas? Devuelve false
 * si la unidad no tiene organización resoluble o si ningún canal retiene.
 */
async function channelRequestOverlap(
  admin: ReturnType<typeof createAdminClient>,
  params: { unitId: string; checkInIso: string; checkOutIso: string },
): Promise<boolean> {
  const { data: unit, error: unitErr } = await admin
    .from("units")
    .select("organization_id")
    .eq("id", params.unitId)
    .maybeSingle();
  if (unitErr) throw new Error(unitErr.message);
  if (!unit?.organization_id) return false;

  const { policies, failed } = await readChannelRequestPolicies(admin, unit.organization_id);
  // "No pude leer la política" no puede leerse como "ningún canal retiene": con
  // instant_book el checkout inserta la reserva solo y, como las solicitudes no
  // tienen fila en `bookings`, no hay constraint que atrape el solapamiento.
  if (failed) throw new Error("no se pudo leer la política de solicitudes de canal");
  const holdChannels = channelsHoldingAvailability(policies);
  if (holdChannels.length === 0) return false;

  const { data, error } = await admin
    .from("channel_reservations")
    .select("id, last_seen_at")
    .eq("unit_id", params.unitId)
    .eq("external_status", "pending")
    .in("channel", holdChannels)
    .lt("check_in", params.checkOutIso)
    .gt("check_out", params.checkInIso)
    .limit(20);
  // Un fallo de lectura NO puede leerse como "no hay solapamiento": con
  // instant_book el checkout inserta la reserva solo, y como las solicitudes no
  // tienen fila en `bookings` no hay constraint que lo atrape después.
  if (error) throw new Error(error.message);
  return (data ?? []).some((r) => isFresh(r.last_seen_at as string | null));
}

/**
 * Techo duro de retención: una solicitud sin señal de vida hace más de una
 * semana está huérfana (conexión pausada o borrada — el dispatcher sólo ve
 * links `active`) y deja de bloquear. `null` cuenta como fresca: podría haber
 * entrado por email y no tener `last_seen_at`.
 * Se filtra en memoria para no depender de cómo PostgREST parsea un `or` con un
 * timestamp adentro.
 */
function isFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const t = Date.parse(lastSeenAt);
  return Number.isNaN(t) || Date.now() - t < REQUEST_HOLD_MAX_AGE_MS;
}

/** Rangos retenidos por solicitudes de canal sin confirmar (ver arriba). */
async function channelRequestRanges(
  admin: ReturnType<typeof createAdminClient>,
  params: { unitId: string; fromIso: string; toIso: string },
): Promise<{ start: string; end: string }[]> {
  const { data: unit } = await admin
    .from("units")
    .select("organization_id")
    .eq("id", params.unitId)
    .maybeSingle();
  if (!unit?.organization_id) return [];

  const { policies, failed } = await readChannelRequestPolicies(admin, unit.organization_id);
  // Acá NO se lanza, a diferencia de checkUnitAvailability: esto sólo pinta el
  // date-picker de una página pública, y la verificación autoritativa del
  // checkout sí falla cerrado. Tumbar /u/[slug] por un blip de channel_settings
  // sería peor que mostrar una fecha de más.
  if (failed) {
    console.error("[marketplace/availability] política de solicitudes ilegible; date-picker sin holds");
    return [];
  }
  const holdChannels = channelsHoldingAvailability(policies);
  if (holdChannels.length === 0) return [];

  const { data, error } = await admin
    .from("channel_reservations")
    .select("check_in, check_out, last_seen_at")
    .eq("unit_id", params.unitId)
    .eq("external_status", "pending")
    .in("channel", holdChannels)
    .lt("check_in", params.toIso)
    .gt("check_out", params.fromIso);
  // Un fallo acá mostraría libres en el date-picker fechas que sí están
  // retenidas. Mejor propagarlo: getBlockedDates ya corre dentro de un flujo
  // que puede fallar visiblemente.
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => r.check_in && r.check_out && isFresh(r.last_seen_at as string | null))
    .map((r) => ({ start: r.check_in as string, end: r.check_out as string }));
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
  const [bookingsRes, requestsRes, otaRes] = await Promise.all([
    admin
      .from("bookings")
      .select("check_in_date, check_out_date")
      .eq("unit_id", params.unitId)
      .in("status", OCCUPYING_BOOKING_STATUSES as unknown as string[])
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
    channelRequestRanges(admin, params),
  ]);

  const ranges: { start: string; end: string }[] = [];
  for (const b of bookingsRes.data ?? []) {
    ranges.push({ start: b.check_in_date, end: b.check_out_date });
  }
  for (const r of requestsRes.data ?? []) {
    ranges.push({ start: r.check_in_date, end: r.check_out_date });
  }
  ranges.push(...otaRes);

  const blocked = new Set<string>();
  for (const r of ranges) {
    // Acotamos a la ventana visible [fromIso, toIso): un bloqueo que empieza
    // mucho antes de fromIso (p.ej. estadía de años) agotaría el tope de
    // iteraciones antes de llegar a las fechas que el date-picker muestra,
    // dejando el calendario visible como "disponible" cuando no lo está.
    let cursor = r.start < params.fromIso ? params.fromIso : r.start;
    let safety = 0;
    while (cursor < r.end && cursor < params.toIso && safety < 366 * 2) {
      blocked.add(cursor);
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
      safety++;
    }
  }
  return Array.from(blocked).sort();
}
