import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { runChannelDispatch } from "@/lib/channels/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dispatcher de Canales de venta — lo dispara Supabase pg_cron:
 *   - apartcba_channel_dispatch_v2  (cada minuto, mode=dispatch)
 *   - apartcba_channel_reconcile_v2 (diario 06:20 UTC, mode=reconcile)
 *
 * FAIL-CLOSED: sin PG_CRON_SECRET configurado el endpoint no ejecuta nada.
 */
export async function POST(req: Request) {
  const expected = process.env.PG_CRON_SECRET;
  if (!expected) {
    console.error("[cron/channel-dispatch] PG_CRON_SECRET no configurado — rechazando");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const provided = req.headers.get("x-pg-cron-secret") ?? "";
  if (!timingSafeEqualStr(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let mode: "dispatch" | "reconcile" = "dispatch";
  try {
    const body = await req.json();
    if (body?.mode === "reconcile") mode = "reconcile";
  } catch {
    // sin body → dispatch
  }

  const admin = createAdminClient();
  const summary = await runChannelDispatch(admin, mode);

  // Una reserva de OTA que entra por acá se proyecta a `bookings` sin pasar por
  // ninguna server action, así que nadie invalidaba el cache de las pantallas
  // que la muestran. La pestaña abierta se entera por Realtime; esto es para
  // que NAVEGAR tampoco devuelva la foto anterior.
  if (summary.imported > 0 || summary.updated > 0 || summary.cancelled > 0) {
    for (const path of [
      "/dashboard",
      "/dashboard/reservas",
      "/dashboard/unidades/kanban",
      "/dashboard/unidades/calendario/mensual",
      "/dashboard/canales",
      "/dashboard/parte-diario",
    ]) {
      revalidatePath(path);
    }
  }

  return NextResponse.json({ ok: true, mode, ...summary });
}

export async function GET() {
  // el dispatcher solo acepta POST autenticado
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
