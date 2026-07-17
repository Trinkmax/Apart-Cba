import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { tokenMatchesHash } from "@/lib/channels/token";
import { buildUnitCalendar } from "@/lib/channels/outbound-ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Calendario iCal SALIENTE por conexión — Airbnb/Booking lo importan para
 * bloquear fechas vendidas por otros canales.
 *
 * URL: /api/channels/ical/<linkId>.ics?token=<secreto>
 *
 *   - el token se compara contra su hash SHA-256 en tiempo constante
 *   - ETag determinista + If-None-Match → 304
 *   - contenido generado del estado actual; sin caché compartida entre unidades
 *   - el token nunca se loguea; solo se registra el acceso (salud)
 */
export async function GET(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const { linkId: rawLinkId } = await ctx.params;
  const linkId = rawLinkId.replace(/\.ics$/i, "");
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new NextResponse("Missing token", { status: 401 });
  if (!/^[0-9a-f-]{16,64}$/i.test(linkId)) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("channel_links")
    .select(
      "id, organization_id, unit_id, channel, status, export_token_hash, last_export_access_at, unit:units(id, code, name, organization_id)",
    )
    .eq("id", linkId)
    .maybeSingle();

  // 404 uniforme: no revelamos si el link existe
  if (!link || !tokenMatchesHash(token, link.export_token_hash)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const unit = link.unit as unknown as {
    id: string;
    code: string;
    name: string;
    organization_id: string;
  } | null;
  if (!unit || unit.organization_id !== link.organization_id) {
    return new NextResponse("Not found", { status: 404 });
  }

  // registrar acceso (salud del lado saliente) — nunca el token
  await admin
    .from("channel_links")
    .update({ last_export_access_at: new Date().toISOString() })
    .eq("id", link.id);

  const { ics, etag } = await buildUnitCalendar(admin, unit);

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="apartcba-${unit.code}.ics"`,
      // sin caché compartida: el token viaja en la URL y el contenido es por unidad
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });
}
