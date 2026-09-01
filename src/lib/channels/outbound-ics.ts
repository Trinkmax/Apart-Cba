import crypto from "crypto";
import { channelsExportedAsHolds, readChannelRequestPolicies } from "./request-policy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Generador del calendario iCal SALIENTE de una unidad — lo importan
 * Airbnb/Booking para bloquear fechas vendidas por otros canales.
 *
 * Incluye TODO lo que retiene disponibilidad:
 *   - bookings pendiente / confirmada / check_in (reservas y bloqueos is_block)
 *   - booking_requests pendientes y no vencidas (retienen el calendario)
 *   - solicitudes de canal (channel_reservations 'pending') SÓLO de los canales
 *     cuya política tiene hold_availability. Hoy eso es Booking.com y no Airbnb:
 *     una solicitud de Airbnb todavía no es una venta (por eso no se cierra el
 *     calendario hasta que se acepte), mientras que un VEVENT de Booking sin
 *     confirmar es o basura o una reserva YA vendida.
 * Excluye: canceladas, no_show, solicitudes vencidas/rechazadas.
 *
 * El contenido es determinista (DTSTAMP derivado del último cambio real), así
 * el ETag es estable entre cambios y las OTAs pueden usar If-None-Match.
 */

const HISTORY_DAYS = 30;
const MAX_EVENTS = 500;
const MAX_CHANNEL_REQUESTS = 100;
/**
 * Una solicitud sin señal de vida (`last_seen_at`) hace más de esto está
 * huérfana — conexión pausada o borrada — y deja de retener fechas.
 */
const REQUEST_HOLD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface UnitCalendar {
  ics: string;
  etag: string;
}

interface ChannelRequestRow {
  id: string;
  check_in: string;
  check_out: string;
  created_at: string;
  last_seen_at: string | null;
  link_id: string | null;
}

/** ¿La OTA la publicó hace poco? `null` cuenta como fresca (entró por email). */
function isFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const t = Date.parse(lastSeenAt);
  return Number.isNaN(t) || Date.now() - t < REQUEST_HOLD_MAX_AGE_MS;
}

export async function buildUnitCalendar(
  admin: AdminClient,
  unit: { id: string; code: string; name: string; organization_id: string },
  opts: { excludeChannelLinkId?: string } = {},
): Promise<UnitCalendar> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const nowIso = new Date().toISOString();

  // Hacia OTRAS OTAs se retiene siempre que la política esté encendida, aunque
  // `hold_availability` sea false: eso último gobierna la web propia. Ver
  // channelsExportedAsHolds().
  const { policies, failed } = await readChannelRequestPolicies(admin, unit.organization_id);
  // Antes de la 057 una solicitud de Airbnb ya estaba en `bookings` y salía en
  // este ICS pasara lo que pasara. Con el gate encendido la protección se mudó
  // a `channel_reservations`, así que un timeout leyendo la política publicaría
  // el calendario SIN esas fechas y la otra OTA las vendería. Preferimos un 500:
  // la OTA conserva su último import bueno.
  if (failed) throw new Error("no se pudo leer la política de solicitudes de canal");
  const holdChannels = channelsExportedAsHolds(policies);

  const [bookingsRes, requestsRes, channelRequestsRes] = await Promise.all([
    admin
      .from("bookings")
      .select("id, source, check_in_date, check_out_date, is_block, updated_at")
      .eq("unit_id", unit.id)
      .eq("organization_id", unit.organization_id)
      .in("status", ["pendiente", "confirmada", "check_in"])
      .gte("check_out_date", since)
      .order("check_in_date", { ascending: true })
      .limit(MAX_EVENTS),
    admin
      .from("booking_requests")
      .select("id, check_in_date, check_out_date, created_at")
      .eq("unit_id", unit.id)
      .eq("organization_id", unit.organization_id)
      .eq("status", "pendiente")
      .gt("expires_at", nowIso)
      .gte("check_out_date", since)
      .limit(100),
    holdChannels.length > 0
      ? admin
          .from("channel_reservations")
          .select("id, check_in, check_out, created_at, last_seen_at, link_id")
          .eq("organization_id", unit.organization_id)
          .eq("unit_id", unit.id)
          .eq("external_status", "pending")
          .in("channel", holdChannels)
          .gte("check_out", since)
          .order("check_in", { ascending: true })
          .limit(MAX_CHANNEL_REQUESTS)
      : Promise.resolve({ data: [] as ChannelRequestRow[], error: null }),
  ]);

  // Un calendario vacío por un timeout es indistinguible de un calendario
  // realmente vacío: la OTA lo importa y libera todas las fechas. Fallar es la
  // única respuesta segura acá.
  if (bookingsRes.error) throw new Error(bookingsRes.error.message);
  if (requestsRes.error) throw new Error(requestsRes.error.message);
  if (channelRequestsRes.error) throw new Error(channelRequestsRes.error.message);

  const bookings = bookingsRes.data ?? [];
  const requests = requestsRes.data ?? [];
  // Nunca le devolvemos a una OTA un bloqueo generado por su PROPIA solicitud
  // pendiente: podría impedir que el anfitrión la acepte desde su panel.
  const channelRequests = ((channelRequestsRes.data ?? []) as ChannelRequestRow[]).filter(
    (r) =>
      (!opts.excludeChannelLinkId || r.link_id !== opts.excludeChannelLinkId) &&
      // Techo duro: ninguna política retiene más de 26 h, así que una solicitud
      // sin señal de vida hace una semana está huérfana (conexión pausada o
      // borrada) y no puede seguir bloqueando fechas. Se filtra en memoria —
      // son pocas filas — para no depender de cómo PostgREST parsea un `or`
      // con un timestamp adentro.
      isFresh(r.last_seen_at),
  );

  // DTSTAMP estable: el mayor updated_at del set (cambia solo cuando algo cambió)
  let maxStamp = "20200101T000000Z";
  for (const b of bookings) {
    const s = toIcsStamp(b.updated_at);
    if (s > maxStamp) maxStamp = s;
  }
  for (const r of requests) {
    const s = toIcsStamp(r.created_at);
    if (s > maxStamp) maxStamp = s;
  }
  // created_at y NO updated_at: `last_seen_at` de una solicitud se refresca cada
  // hora y el trigger de updated_at lo sigue. Con updated_at el ETag cambiaría
  // cada hora sin que cambie el contenido y las OTAs se bajarían el ICS entero.
  for (const r of channelRequests) {
    const s = toIcsStamp(r.created_at);
    if (s > maxStamp) maxStamp = s;
  }

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ApartCba//Canales de venta//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Apart Cba — ${unit.code} ${unit.name}`)}`,
    "X-WR-TIMEZONE:America/Argentina/Cordoba",
  ];

  for (const b of bookings) {
    const summary = b.is_block
      ? "Bloqueado"
      : b.source === "directo"
        ? "Reservado (directo)"
        : `Reservado (${b.source})`;
    pushEvent(lines, {
      uid: `apartcba-${b.id}@apartcba.app`,
      stamp: maxStamp,
      start: b.check_in_date,
      end: b.check_out_date,
      summary,
    });
  }
  for (const r of requests) {
    pushEvent(lines, {
      uid: `apartcba-req-${r.id}@apartcba.app`,
      stamp: maxStamp,
      start: r.check_in_date,
      end: r.check_out_date,
      summary: "Reservado (solicitud pendiente)",
    });
  }
  for (const r of channelRequests) {
    pushEvent(lines, {
      uid: `apartcba-otareq-${r.id}@apartcba.app`,
      stamp: maxStamp,
      start: r.check_in,
      end: r.check_out,
      summary: "Reservado (solicitud pendiente)",
    });
  }

  lines.push("END:VCALENDAR");
  const ics = lines.map(foldLine).join("\r\n") + "\r\n";
  const etag = `"${crypto.createHash("sha256").update(ics).digest("hex").slice(0, 32)}"`;
  return { ics, etag };
}

function pushEvent(
  lines: string[],
  e: { uid: string; stamp: string; start: string; end: string; summary: string },
): void {
  // DTEND exclusivo (half-open): el día de check-out queda libre
  lines.push(
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${e.stamp}`,
    `DTSTART;VALUE=DATE:${e.start.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${e.end.replace(/-/g, "")}`,
    `SUMMARY:${escapeText(e.summary)}`,
    "TRANSP:OPAQUE",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  );
}

function toIcsStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// RFC 5545: líneas > 75 octetos se pliegan con CRLF + espacio
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return out.join("\r\n");
}
