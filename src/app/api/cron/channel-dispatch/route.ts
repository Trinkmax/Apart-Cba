import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { runChannelDispatch } from "@/lib/channels/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El dispatcher se autolimita a 40 s (TOTAL_BUDGET_MS) y no arranca trabajo
// que no pueda terminar antes; 60 s deja margen para cerrar la corrida.
// Debe coincidir con vercel.json (functions[...channel-dispatch/route.ts]).
export const maxDuration = 60;

/**
 * Dispatcher de Canales de venta — lo dispara Supabase pg_cron:
 *   - apartcba_channel_dispatch_v2  (mode=dispatch; cada 2 min — la corrida
 *     loopea hasta agotar las conexiones vencidas, así que la cadencia del
 *     cron no limita la capacidad)
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

  const startedAt = Date.now();
  const admin = createAdminClient();
  const summary = await runChannelDispatch(admin, mode);

  // Una sola línea por corrida: alcanza para correlacionar con channel_sync_runs
  // sin inflar Observability Events (que también se cobra).
  console.log(
    `[cron/channel-dispatch] mode=${mode} batches=${summary.batches} claimed=${summary.claimed} processed=${summary.processed} released=${summary.released} imported=${summary.imported} updated=${summary.updated} requested=${summary.requested} promoted=${summary.promoted} discarded=${summary.discarded} proposed=${summary.proposed} errors=${summary.errors} ms=${Date.now() - startedAt}`,
  );

  // Una reserva de OTA que entra por acá se proyecta a `bookings` sin pasar por
  // ninguna server action, así que nadie invalidaba el cache de las pantallas
  // que la muestran. La pestaña abierta se entera por Realtime; esto es para
  // que NAVEGAR tampoco devuelva la foto anterior.
  if (
    summary.imported > 0 ||
    summary.updated > 0 ||
    summary.cancelled > 0 ||
    // Una solicitud que entra, se confirma o se cae cambia lo que ve el
    // operador (grilla, bandeja, badge del sidebar) aunque no toque `bookings`.
    summary.requested > 0 ||
    summary.promoted > 0 ||
    summary.discarded > 0
  ) {
    for (const path of [
      "/dashboard",
      "/dashboard/reservas",
      "/dashboard/reservas-pendientes",
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
