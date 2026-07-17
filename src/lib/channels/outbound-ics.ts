import crypto from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

/**
 * Generador del calendario iCal SALIENTE de una unidad — lo importan
 * Airbnb/Booking para bloquear fechas vendidas por otros canales.
 *
 * Incluye TODO lo que retiene disponibilidad:
 *   - bookings pendiente / confirmada / check_in (reservas y bloqueos is_block)
 *   - booking_requests pendientes y no vencidas (retienen el calendario)
 * Excluye: canceladas, no_show, solicitudes vencidas/rechazadas.
 *
 * El contenido es determinista (DTSTAMP derivado del último cambio real), así
 * el ETag es estable entre cambios y las OTAs pueden usar If-None-Match.
 */

const HISTORY_DAYS = 30;
const MAX_EVENTS = 500;

export interface UnitCalendar {
  ics: string;
  etag: string;
}

export async function buildUnitCalendar(
  admin: AdminClient,
  unit: { id: string; code: string; name: string; organization_id: string },
): Promise<UnitCalendar> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const nowIso = new Date().toISOString();

  const [bookingsRes, requestsRes] = await Promise.all([
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
  ]);

  const bookings = bookingsRes.data ?? [];
  const requests = requestsRes.data ?? [];

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
