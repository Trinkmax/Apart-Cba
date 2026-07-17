import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { buildUnitCalendar } from "@/lib/channels/outbound-ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * ADAPTADOR LEGACY — las URLs /api/ical/<unitId>.ics?token=<units.ical_export_token>
 * ya están pegadas dentro de Airbnb/Booking y deben seguir funcionando.
 * Sirve el MISMO calendario que /api/channels/ical/[linkId] (generador nuevo:
 * bookings + bloqueos + solicitudes vigentes) y registra el acceso en las
 * conexiones de la unidad para el health de Canales de venta.
 */
export async function GET(req: Request, ctx: { params: Promise<{ unitId: string }> }) {
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

  if (!unit || !safeEqual(token, unit.ical_export_token ?? "")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // salud: la OTA consultó el calendario de esta unidad
  await admin
    .from("channel_links")
    .update({ last_export_access_at: new Date().toISOString() })
    .eq("unit_id", unit.id)
    .eq("organization_id", unit.organization_id);

  const { ics, etag } = await buildUnitCalendar(admin, unit);

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="apartcba-${unit.code}.ics"`,
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
