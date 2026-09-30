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

// ─── Disponibilidad en lote (buscador de la web) ─────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>;
type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Tandas para `.in()`: la lista de ids viaja en la URL. */
const BATCH_IN_CHUNK = 150;
/** `max_rows` de PostgREST en Supabase: una respuesta más larga se corta sin avisar. */
const BATCH_PAGE_SIZE = 1000;

function chunkIds(values: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Recorre `.range()` hasta que una página vuelve incompleta. Un rango de
 * fechas largo (hasta 365 noches) sobre toda la vidriera puede pasar las 1000
 * reservas; cortar ahí mostraría como libres unidades que no lo están.
 * El builder tiene que ordenar por algo único para que las páginas no se pisen.
 */
async function readAllRows<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < BATCH_PAGE_SIZE * 50; from += BATCH_PAGE_SIZE) {
    const { data, error } = await page(from, from + BATCH_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < BATCH_PAGE_SIZE) break;
  }
  return out;
}

/**
 * Unidades (de `unitIds`) que NO se pueden reservar en [checkIn, checkOut).
 * Es la versión en lote de `checkUnitAvailability` para el buscador: los
 * mismos tres motivos, en tres consultas para toda la vidriera en vez de tres
 * por unidad.
 *   1. `bookings` que ocupan (OCCUPYING_BOOKING_STATUSES) y solapan.
 *   2. `booking_requests` pendientes que todavía no vencieron y solapan.
 *   3. Solicitudes de canal sin confirmar (`channel_reservations` pending),
 *      sólo de los canales cuya política retiene disponibilidad en la web
 *      propia — la política es por organización, se lee por cada una.
 *
 * Esto sólo decide qué se muestra como disponible; la verificación
 * autoritativa sigue siendo `checkUnitAvailability` al pedir y, al final, los
 * constraints de solapamiento. Un error de lectura se LANZA (no se puede leer
 * como "todo libre"); quien llama decide cómo mostrarlo.
 */
export async function getUnavailableUnitIds(params: {
  unitIds: string[];
  checkInIso: string;
  checkOutIso: string;
}): Promise<string[]> {
  const unitIds = Array.from(new Set(params.unitIds.filter(Boolean)));
  if (unitIds.length === 0) return [];
  // Mismo criterio que checkUnitAvailability: fechas inválidas = nada disponible.
  if (params.checkOutIso <= params.checkInIso) return unitIds;

  const admin = createAdminClient();
  const range = { checkInIso: params.checkInIso, checkOutIso: params.checkOutIso };
  const perChunk = await Promise.all(
    chunkIds(unitIds, BATCH_IN_CHUNK).map(async (ids) => {
      const [booked, requested, held] = await Promise.all([
        bookedUnitIds(admin, ids, range),
        requestedUnitIds(admin, ids, range),
        channelHeldUnitIds(admin, ids, range),
      ]);
      return [...booked, ...requested, ...held];
    }),
  );

  const unavailable = new Set(perChunk.flat());
  // Mismo orden que la entrada: la respuesta es estable y fácil de comparar.
  return unitIds.filter((id) => unavailable.has(id));
}

type BatchRange = { checkInIso: string; checkOutIso: string };

/** 1) Unidades con `bookings` que ocupan el calendario y solapan el rango. */
async function bookedUnitIds(
  admin: AdminClient,
  unitIds: string[],
  range: BatchRange,
): Promise<string[]> {
  const rows = await readAllRows<{ unit_id: string | null }>((from, to) =>
    admin
      .from("bookings")
      .select("id, unit_id")
      .in("unit_id", unitIds)
      .in("status", OCCUPYING_BOOKING_STATUSES as unknown as string[])
      .lt("check_in_date", range.checkOutIso)
      .gt("check_out_date", range.checkInIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => r.unit_id).filter((id): id is string => Boolean(id));
}

/** 2) Unidades con pedidos web pendientes y vigentes que solapan el rango. */
async function requestedUnitIds(
  admin: AdminClient,
  unitIds: string[],
  range: BatchRange,
): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const rows = await readAllRows<{ unit_id: string | null }>((from, to) =>
    admin
      .from("booking_requests")
      .select("id, unit_id")
      .in("unit_id", unitIds)
      .eq("status", "pendiente")
      .gt("expires_at", nowIso)
      .lt("check_in_date", range.checkOutIso)
      .gt("check_out_date", range.checkInIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => r.unit_id).filter((id): id is string => Boolean(id));
}

/**
 * 3) Unidades con solicitudes de canal sin confirmar que retienen. Se leen
 * todas las pendientes que solapan (son pocas) y se filtran por la política de
 * SU organización: la vidriera puede mezclar organizaciones con políticas
 * distintas. Si la política de una organización no se puede leer, sus
 * solicitudes cuentan como retenidas (falla cerrado, igual que
 * checkUnitAvailability: con instant_book no hay constraint que ataje el
 * solapamiento, porque la solicitud no tiene fila en `bookings`).
 */
async function channelHeldUnitIds(
  admin: AdminClient,
  unitIds: string[],
  range: BatchRange,
): Promise<string[]> {
  const rows = await readAllRows<{
    unit_id: string | null;
    organization_id: string;
    channel: string;
    last_seen_at: string | null;
  }>((from, to) =>
    admin
      .from("channel_reservations")
      .select("id, unit_id, organization_id, channel, last_seen_at")
      .in("unit_id", unitIds)
      .eq("external_status", "pending")
      .lt("check_in", range.checkOutIso)
      .gt("check_out", range.checkInIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const fresh = rows.filter((r) => r.unit_id && isFresh(r.last_seen_at));
  if (fresh.length === 0) return [];

  const orgIds = Array.from(new Set(fresh.map((r) => r.organization_id)));
  const holdByOrg = new Map<string, Set<string> | "all">();
  await Promise.all(
    orgIds.map(async (orgId) => {
      const { policies, failed } = await readChannelRequestPolicies(admin, orgId);
      if (failed) {
        console.error(
          "[marketplace/availability] política de solicitudes ilegible; se retienen todas las del canal",
          orgId,
        );
        holdByOrg.set(orgId, "all");
        return;
      }
      holdByOrg.set(orgId, new Set<string>(channelsHoldingAvailability(policies)));
    }),
  );

  return fresh
    .filter((r) => {
      const hold = holdByOrg.get(r.organization_id);
      return hold === "all" || (hold?.has(r.channel) ?? false);
    })
    .map((r) => r.unit_id as string);
}
