import { after, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { buildUnitCalendar } from "@/lib/channels/outbound-ics";
import { recordExportRead } from "@/lib/channels/export-read-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * ADAPTADOR LEGACY — las URLs /api/ical/<unitId>.ics?token=<units.ical_export_token>
 * ya están pegadas dentro de Airbnb/Booking y deben seguir funcionando.
 * Sirve el MISMO calendario que /api/channels/ical/[linkId] (generador nuevo:
 * bookings + bloqueos + solicitudes vigentes).
 *
 * Esta dirección es una sola por departamento, así que no dice cuál de sus
 * conexiones está leyendo. Antes le sellaba la hora a todas: con Booking
 * leyendo, la de Airbnb figuraba «consultada hace 20 min» aunque Airbnb no
 * hubiera pasado (o hubiera dejado de leer). Ahora la lectura se le anota a
 * quien corresponde: ver `attributeUnitRead` en export-reads.ts.
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

  const { ics, etag, stays } = await buildUnitCalendar(admin, unit);
  const notModified = req.headers.get("if-none-match") === etag;

  // Con la respuesta ya enviada: la OTA no espera por esto, y si falla el
  // calendario se sirvió igual.
  const userAgent = req.headers.get("user-agent");
  after(() =>
    recordExportRead(admin, {
      via: "unit",
      unit: { id: unit.id as string, organization_id: unit.organization_id as string },
      userAgent,
      httpStatus: notModified ? 304 : 200,
      etag,
      stays,
    }),
  );

  if (notModified) {
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
