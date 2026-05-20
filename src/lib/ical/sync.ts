import ICAL from "ical.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { BookingSource } from "@/lib/types/database";

export type TriggerSource = "cron" | "manual" | "create_feed";

export interface SyncResult {
  imported: number;
  skipped: number;
  error?: string;
}

interface FeedRow {
  id: string;
  organization_id: string;
  unit_id: string;
  source: string;
  feed_url: string;
  events_imported_count: number;
}

/**
 * Sincroniza un único feed iCal: descarga, parsea, e inserta reservas nuevas.
 * Función pura que no depende de session/org — recibe el admin client y feed.
 * Registra cada corrida en ical_sync_runs para historial y health.
 */
export async function syncSingleFeed(
  admin: AdminClient,
  feed: FeedRow,
  triggerSource: TriggerSource = "manual"
): Promise<SyncResult> {
  // Crear sync run
  const { data: run } = await admin
    .from("ical_sync_runs")
    .insert({
      feed_id: feed.id,
      organization_id: feed.organization_id,
      trigger_source: triggerSource,
    })
    .select("id")
    .single();
  const runId = run?.id;

  let imported = 0;
  let skipped = 0;

  try {
    const res = await fetch(feed.feed_url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const icsText = await res.text();

    const jcalData = ICAL.parse(icsText);
    const comp = new ICAL.Component(jcalData);
    const events = comp.getAllSubcomponents("vevent");

    for (const ev of events) {
      const event = new ICAL.Event(ev);
      const uid = event.uid;
      if (!uid) { skipped++; continue; }

      const startDate = event.startDate.toJSDate();
      const endDate = event.endDate.toJSDate();
      const summary = event.summary ?? "";

      // Detectar bloqueos
      const isBlock = /not available|blocked|unavailable|closed/i.test(summary);

      // Self-import guard
      if (uid.includes("apartcba-")) { skipped++; continue; }

      // Dedup por (organization_id, unit_id, source, external_id)
      const { data: existing } = await admin
        .from("bookings")
        .select("id")
        .eq("organization_id", feed.organization_id)
        .eq("unit_id", feed.unit_id)
        .eq("source", feed.source as BookingSource)
        .eq("external_id", uid)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      const { error: insertError } = await admin.from("bookings").insert({
        organization_id: feed.organization_id,
        unit_id: feed.unit_id,
        source: feed.source as BookingSource,
        external_id: uid,
        status: "confirmada",
        check_in_date: startDate.toISOString().slice(0, 10),
        check_in_time: "14:00",
        check_out_date: endDate.toISOString().slice(0, 10),
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 0,
        notes: isBlock ? "Bloqueo (sin reserva real)" : `Importado de ${feed.source}: ${summary}`,
        guests_count: 1,
      });

      if (!insertError) imported++;
      else if (insertError.message.includes("bookings_no_overlap")) skipped++;
    }

    // Update feed status (retrocompat)
    await admin
      .from("ical_feeds")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
        events_imported_count: feed.events_imported_count + imported,
      })
      .eq("id", feed.id);

    // Finalizar sync run
    if (runId) {
      await admin
        .from("ical_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "ok",
          imported_count: imported,
          skipped_count: skipped,
        })
        .eq("id", runId);
    }

    return { imported, skipped };
  } catch (e) {
    const errorMsg = (e as Error).message;

    // Update feed status
    await admin
      .from("ical_feeds")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "error",
        last_sync_error: errorMsg,
      })
      .eq("id", feed.id);

    // Finalizar sync run con error
    if (runId) {
      await admin
        .from("ical_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          imported_count: imported,
          skipped_count: skipped,
          error_message: errorMsg,
        })
        .eq("id", runId);
    }

    return { imported, skipped, error: errorMsg };
  }
}

/**
 * Sync de todos los feeds activos (para cron o trigger manual global).
 * No depende de session/org — itera todas las orgs.
 */
export async function syncAllFeedsCron(
  admin: AdminClient,
  triggerSource: TriggerSource = "cron"
): Promise<{ totalImported: number; totalSkipped: number; errors: number }> {
  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, events_imported_count")
    .eq("active", true);

  const results = { totalImported: 0, totalSkipped: 0, errors: 0 };
  for (const feed of feeds ?? []) {
    const r = await syncSingleFeed(admin, feed, triggerSource);
    results.totalImported += r.imported;
    results.totalSkipped += r.skipped;
    if (r.error) results.errors++;
  }
  return results;
}
