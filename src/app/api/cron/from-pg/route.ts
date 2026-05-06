import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processOutbox } from "@/lib/crm/outbox";
import { runWorkflow } from "@/lib/crm/workflows/executor";
import { dispatchEvent } from "@/lib/crm/workflows/dispatcher";
import { getProviderForChannel } from "@/lib/crm/providers/factory";
import { getTranscriberForOrg } from "@/lib/crm/ai/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint disparado por:
 *   1. pg_cron cada 5 min (dispatcher subdaily)
 *   2. Server actions fire-and-forget (immediate runner)
 *   3. Acciones específicas via query (?action=media-download)
 *
 * Validación: header x-pg-cron-secret debe matchear PG_CRON_SECRET env.
 */

function authorize(req: Request): boolean {
  const expected = process.env.PG_CRON_SECRET;
  if (!expected) return true; // dev sin secret: permitir
  const provided = req.headers.get("x-pg-cron-secret");
  return provided === expected;
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Acción específica: download media + transcribe
  if (action === "media-download") {
    const orgId = url.searchParams.get("org");
    const channelId = url.searchParams.get("channel");
    const messageId = url.searchParams.get("msg");
    const metaMediaId = url.searchParams.get("meta");
    if (!orgId || !channelId || !messageId || !metaMediaId) {
      return NextResponse.json({ error: "missing_params" }, { status: 400 });
    }
    try {
      await downloadAndStoreMedia(orgId, channelId, messageId, metaMediaId);
      return NextResponse.json({ ok: true, action: "media-download" });
    } catch (err) {
      console.error("[from-pg/media-download]", err);
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
    }
  }

  // Default: dispatcher loop (cada 5min de pg_cron o immediate desde Server Action)
  const result = await runDispatcherTick();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}

interface TickResult {
  outbox: { processed: number; sent: number; failed: number };
  runs_resumed: number;
  schedules_fired: number;
  broadcasts_progressed: number;
}

async function runDispatcherTick(): Promise<TickResult> {
  const admin = createAdminClient();

  // 1. Procesar outbox
  const outbox = await processOutbox({ limit: 50 });

  // 2. Resume runs suspendidos con resume_at <= now
  const now = new Date().toISOString();
  const { data: dueRuns } = await admin
    .from("crm_workflow_runs")
    .select("id")
    .eq("status", "suspended")
    .lte("resume_at", now)
    .limit(20);

  let runsResumed = 0;
  for (const run of dueRuns ?? []) {
    await admin.from("crm_workflow_runs").update({ status: "queued" }).eq("id", run.id);
    runsResumed += 1;
  }

  // 3. Procesar runs queued
  const { data: queuedRuns } = await admin
    .from("crm_workflow_runs")
    .select("id")
    .eq("status", "queued")
    .limit(10);

  for (const run of queuedRuns ?? []) {
    try {
      await runWorkflow({ runId: run.id });
    } catch (err) {
      console.error("[from-pg] run failed", run.id, err);
    }
  }

  // 4. Procesar schedules con next_run_at <= now (sub-daily, e.g. cada 15min)
  const { data: schedules } = await admin
    .from("crm_workflow_schedules")
    .select("id,workflow_id,organization_id,cron_expression,next_run_at")
    .eq("active", true)
    .lte("next_run_at", now)
    .limit(20);

  let schedulesFired = 0;
  for (const sch of schedules ?? []) {
    await dispatchEvent({
      organizationId: sch.organization_id,
      eventType: "scheduled.tick",
      payload: { schedule_id: sch.id, workflow_id: sch.workflow_id },
    });
    // Reagendar (cálculo simple: cada N minutos basado en cron — para MVP sumamos 5 min)
    const nextRun = computeNextRun(sch.cron_expression, sch.next_run_at);
    await admin
      .from("crm_workflow_schedules")
      .update({ next_run_at: nextRun.toISOString(), last_run_at: now })
      .eq("id", sch.id);
    schedulesFired += 1;
  }

  // 5. Procesar broadcasts: arrancar los queued cuyo scheduled_at venció +
  //    avanzar batch de los que están en "sending"
  let broadcastsProgressed = 0;
  const { data: dueBroadcasts } = await admin
    .from("crm_broadcasts")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .limit(5);
  for (const b of dueBroadcasts ?? []) {
    await admin
      .from("crm_broadcasts")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", b.id);
  }

  const { data: sendingBroadcasts } = await admin
    .from("crm_broadcasts")
    .select("id")
    .eq("status", "sending")
    .limit(5);
  for (const b of sendingBroadcasts ?? []) {
    try {
      const { processBroadcastBatch } = await import("@/lib/actions/crm-broadcasts");
      const r = await processBroadcastBatch(b.id, 50);
      broadcastsProgressed += r.sent;
    } catch (err) {
      console.error("[from-pg/broadcast]", b.id, err);
    }
  }

  return { outbox, runs_resumed: runsResumed, schedules_fired: schedulesFired, broadcasts_progressed: broadcastsProgressed };
}

function computeNextRun(cronExpr: string, _currentNext: string): Date {
  // MVP: parser cron simple. Soporta "*/N * * * *" y "0 H * * *".
  // Para casos más complejos, agregar dependencia 'cron-parser' en fase 2.
  const m = cronExpr.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) {
    return new Date(Date.now() + parseInt(m[1], 10) * 60_000);
  }
  // Default: 1 hora
  return new Date(Date.now() + 60 * 60_000);
}

async function downloadAndStoreMedia(
  orgId: string,
  channelId: string,
  messageId: string,
  metaMediaId: string,
) {
  const admin = createAdminClient();
  const provider = await getProviderForChannel(channelId);
  const meta = await provider.getMediaDownloadUrl(metaMediaId);

  // Descargar binario (Meta exige Bearer en GET)
  const accessToken = await getAccessTokenForChannel(channelId);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`media download failed: ${res.status}`);
  const buffer = await res.arrayBuffer();

  // Subir a Supabase Storage
  const ext = mimeToExt(meta.mime);
  const path = `${orgId}/${messageId}.${ext}`;
  const { error: uploadErr } = await admin.storage.from("crm-media").upload(path, buffer, {
    contentType: meta.mime,
    upsert: true,
  });
  if (uploadErr) throw new Error(`storage upload failed: ${uploadErr.message}`);

  // Generar signed URL (TTL 7 días)
  const { data: signed } = await admin.storage.from("crm-media").createSignedUrl(path, 60 * 60 * 24 * 7);

  await admin
    .from("crm_messages")
    .update({
      media_storage_path: path,
      media_url: signed?.signedUrl,
      media_mime: meta.mime,
      media_size_bytes: meta.size,
    })
    .eq("id", messageId);

  // Si es audio, transcribir
  if (meta.mime.startsWith("audio/")) {
    try {
      const transcriber = await getTranscriberForOrg(orgId);
      const result = await transcriber.transcribe({
        audioBuffer: buffer,
        mime: meta.mime,
        language: "es",
      });
      await admin
        .from("crm_messages")
        .update({
          transcription_text: result.text,
          transcription_language: result.language,
          media_duration_ms: result.durationSec ? Math.round(result.durationSec * 1000) : null,
        })
        .eq("id", messageId);
    } catch (err) {
      // Transcription es best-effort — si no hay key configurada o falla, seguimos.
      console.warn("[from-pg/transcribe] skipped", (err as Error).message);
    }
  }
}

async function getAccessTokenForChannel(channelId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: ch } = await admin
    .from("crm_channels")
    .select("access_token_secret_id")
    .eq("id", channelId)
    .single();
  if (!ch?.access_token_secret_id) throw new Error("no_access_token");
  const { getSecret } = await import("@/lib/crm/encryption");
  const tok = await getSecret(ch.access_token_secret_id);
  if (!tok) throw new Error("access_token_resolve_failed");
  return tok;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}
