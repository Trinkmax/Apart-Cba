import ICAL from "ical.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { BookingSource } from "@/lib/types/database";

export type TriggerSource = "cron" | "manual" | "create_feed";

export interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  conflicts: number;
  cancelled: number;
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
 * Sincroniza un único feed iCal: descarga, parsea, e inserta/actualiza reservas.
 * Función pura que no depende de session/org — recibe el admin client y feed.
 * Registra cada corrida en ical_sync_runs para historial y health.
 *
 * Los conflictos de fecha (una reserva entrante que se superpone con otra
 * existente) NO se descartan en silencio: generan una notification `critical`
 * para que el operador los resuelva.
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
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  let cancelled = 0;
  const seenUids = new Set<string>();

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
      const checkInDate = startDate.toISOString().slice(0, 10);
      const checkOutDate = endDate.toISOString().slice(0, 10);

      // Detectar bloqueos
      const isBlock = /not available|blocked|unavailable|closed/i.test(summary);

      // Self-import guard
      if (uid.includes("apartcba-")) { skipped++; continue; }

      // Track UIDs presentes en este feed para diff de cancelaciones más abajo
      seenUids.add(uid);

      // Dedup por (organization_id, unit_id, source, external_id)
      const { data: existing } = await admin
        .from("bookings")
        .select("id, check_in_date, check_out_date, status")
        .eq("organization_id", feed.organization_id)
        .eq("unit_id", feed.unit_id)
        .eq("source", feed.source as BookingSource)
        .eq("external_id", uid)
        .maybeSingle();

      if (existing) {
        // Ya existe. Si la OTA cambió las fechas y la reserva sigue en el estado
        // con que la importa el sync ('confirmada'), propagamos el cambio. Si no
        // cambió nada, o la reserva ya progresó/se canceló, la dejamos como está.
        const datesChanged =
          existing.check_in_date !== checkInDate || existing.check_out_date !== checkOutDate;
        if (existing.status === "confirmada" && datesChanged) {
          const { error: updateError } = await admin
            .from("bookings")
            .update({ check_in_date: checkInDate, check_out_date: checkOutDate })
            .eq("id", existing.id);
          if (!updateError) {
            updated++;
          } else if (updateError.message.includes("bookings_no_overlap")) {
            conflicts++;
            await notifyConflict(admin, feed, uid, checkInDate, checkOutDate, "cambio de fechas");
          } else {
            console.error("[ical/sync] update falló", uid, updateError.message);
            skipped++;
          }
        } else {
          skipped++;
        }
        continue;
      }

      const { error: insertError } = await admin.from("bookings").insert({
        organization_id: feed.organization_id,
        unit_id: feed.unit_id,
        source: feed.source as BookingSource,
        external_id: uid,
        status: "confirmada",
        check_in_date: checkInDate,
        check_in_time: "14:00",
        check_out_date: checkOutDate,
        check_out_time: "10:00",
        currency: "ARS",
        total_amount: 0,
        notes: isBlock ? "Bloqueo (sin reserva real)" : `Importado de ${feed.source}: ${summary}`,
        guests_count: 1,
      });

      if (!insertError) {
        imported++;
      } else if (insertError.message.includes("bookings_no_overlap")) {
        conflicts++;
        await notifyConflict(admin, feed, uid, checkInDate, checkOutDate, "reserva nueva");
      } else {
        console.error("[ical/sync] insert falló", uid, insertError.message);
        skipped++;
      }
    }

    // Diff de cancelaciones: si una reserva activa importada antes ya no aparece
    // en el feed, la OTA la canceló. Solo corremos esto si el feed devolvió
    // algún evento — un feed vacío suele ser un error temporal de la OTA y no
    // queremos cancelar todo en cascada.
    //
    // Importante: filtramos `guest_id IS NULL` para tocar SOLO las reservas que
    // creó el propio sync iCal. Las reservas con huésped vienen del inbound
    // email (o son directas) y no deben cancelarse porque su id no esté en el
    // feed — usan otro espacio de identificadores.
    if (events.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: activeBookings } = await admin
        .from("bookings")
        .select("id, external_id, check_in_date")
        .eq("organization_id", feed.organization_id)
        .eq("unit_id", feed.unit_id)
        .eq("source", feed.source as BookingSource)
        .in("status", ["confirmada", "check_in"])
        .is("guest_id", null)
        .not("external_id", "is", null)
        .gte("check_out_date", today);

      const toCancel = (activeBookings ?? []).filter(
        (b) => b.external_id && !seenUids.has(b.external_id),
      );

      if (toCancel.length > 0) {
        const ids = toCancel.map((b) => b.id);
        const { error: cancelErr } = await admin
          .from("bookings")
          .update({
            status: "cancelada",
            cancelled_at: new Date().toISOString(),
            cancelled_reason: `Cancelada en ${feed.source} (detectada por sync iCal)`,
          })
          .in("id", ids);
        if (!cancelErr) cancelled = ids.length;
      }
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
          updated_count: updated,
          skipped_count: skipped,
          conflict_count: conflicts,
        })
        .eq("id", runId);
    }

    return { imported, updated, skipped, conflicts, cancelled };
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
          updated_count: updated,
          skipped_count: skipped,
          conflict_count: conflicts,
          error_message: errorMsg,
        })
        .eq("id", runId);
    }

    return { imported, updated, skipped, conflicts, cancelled, error: errorMsg };
  }
}

/**
 * Notifica a los admin de la org que una reserva entrante por iCal se superpone
 * con otra reserva existente en la misma unidad. El dedup_key evita repetir la
 * misma alerta en cada corrida del sync.
 */
async function notifyConflict(
  admin: AdminClient,
  feed: FeedRow,
  uid: string,
  checkIn: string,
  checkOut: string,
  reason: string,
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    organization_id: feed.organization_id,
    type: "inbound_booking_conflict",
    severity: "critical",
    title: `Conflicto de fechas al sincronizar ${feed.source}`,
    body: `Una reserva de ${feed.source} (${checkIn} → ${checkOut}, ${reason}) se superpone con otra reserva existente en la unidad. Resolvé el conflicto manualmente.`,
    target_role: "admin",
    action_url: "/dashboard/channel-manager",
    dedup_key: `ical_conflict:${feed.id}:${uid}`,
  });
  if (error && error.code !== "23505") {
    console.error("[ical/sync:notify]", error);
  }
}

/**
 * Sync de todos los feeds activos (para cron o trigger manual global).
 * No depende de session/org — itera todas las orgs.
 */
export async function syncAllFeedsCron(
  admin: AdminClient,
  triggerSource: TriggerSource = "cron"
): Promise<{
  totalImported: number;
  totalUpdated: number;
  totalSkipped: number;
  totalConflicts: number;
  totalCancelled: number;
  errors: number;
}> {
  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, events_imported_count")
    .eq("active", true);

  const results = {
    totalImported: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    totalConflicts: 0,
    totalCancelled: 0,
    errors: 0,
  };
  for (const feed of feeds ?? []) {
    const r = await syncSingleFeed(admin, feed, triggerSource);
    results.totalImported += r.imported;
    results.totalUpdated += r.updated;
    results.totalSkipped += r.skipped;
    results.totalConflicts += r.conflicts;
    results.totalCancelled += r.cancelled;
    if (r.error) results.errors++;
  }
  return results;
}
