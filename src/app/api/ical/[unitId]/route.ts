import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Feed iCal público de salida — Airbnb/Booking lo importan para evitar
 * doble-reservas con reservas directas cargadas en Apart-Cba.
 *
 * URL: /api/ical/<unitId>.ics?token=<ical_export_token>
 * El token se guarda en apartcba.units.ical_export_token (per-unit secret).
 * No autentica usuarios — actúa como un secret-as-URL.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ unitId: string }> }
) {
  const { unitId: rawUnitId } = await ctx.params;
  const unitId = rawUnitId.replace(/\.ics$/i, "");
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new NextResponse("Missing token", { status: 401 });

  const admin = createAdminClient();
  const { data: unit } = await admin
    .from("units")
    .select("id, code, name, organization_id, ical_export_token")
    .eq("id", unitId)
    .maybeSingle();

  if (!unit || unit.ical_export_token !== token) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Solo reservas vigentes (no canceladas / no_show) que ocupan calendario
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, source, external_id, check_in_date, check_out_date, status, notes")
    .eq("unit_id", unit.id)
    .eq("organization_id", unit.organization_id)
    .not("status", "in", "(cancelada,no_show)")
    .order("check_in_date", { ascending: true });

  const ics = buildIcs(unit, bookings ?? []);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="apartcba-${unit.code}.ics"`,
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

interface UnitInfo {
  id: string;
  code: string;
  name: string;
}
interface BookingRow {
  id: string;
  source: string;
  external_id: string | null;
  check_in_date: string;
  check_out_date: string;
  status: string;
  notes: string | null;
}

function buildIcs(unit: UnitInfo, bookings: BookingRow[]): string {
  const now = formatIcsTimestamp(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apart Cba//Channel Manager//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Apart Cba — ${unit.code} ${unit.name}`)}`,
    "X-WR-TIMEZONE:America/Argentina/Cordoba",
  ];

  for (const b of bookings) {
    // En iCal, DTEND es exclusivo: el día de check-out NO está bloqueado.
    const dtStart = b.check_in_date.replace(/-/g, "");
    const dtEnd = b.check_out_date.replace(/-/g, "");
    const uid = `apartcba-${b.id}@apartcba.app`;
    const summary = b.source === "directo"
      ? "Reservado (directo)"
      : `Reservado (${b.source})`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeText(summary)}`,
      "TRANSP:OPAQUE",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatIcsTimestamp(d: Date): string {
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

// RFC 5545: líneas > 75 octetos deben plegarse con CRLF + espacio
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
