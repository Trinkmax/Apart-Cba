"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import ICAL from "ical.js";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import type { IcalFeed, BookingSource } from "@/lib/types/database";

const feedSchema = z.object({
  unit_id: z.string().uuid(),
  source: z.enum(["airbnb", "booking", "expedia", "vrbo", "otro"]),
  label: z.string().optional().nullable(),
  feed_url: z.string().url("URL inválida"),
});

export type IcalFeedInput = z.infer<typeof feedSchema>;

export async function listIcalFeeds() {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ical_feeds")
    .select(`*, unit:units(id, code, name)`)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createIcalFeed(input: IcalFeedInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = feedSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ical_feeds")
    .insert({ ...validated, organization_id: organization.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/channel-manager");
  return data as IcalFeed;
}

export async function deleteIcalFeed(id: string) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { error } = await admin
    .from("ical_feeds")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/channel-manager");
}

/**
 * Sincroniza un feed iCal: descarga, parsea, e inserta nuevas reservas.
 * Idempotente: usa external_id (UID del evento) para evitar duplicados.
 */
export async function syncIcalFeed(feedId: string): Promise<{ imported: number; skipped: number }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: feed } = await admin
    .from("ical_feeds")
    .select("*, unit:units(id)")
    .eq("id", feedId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!feed) throw new Error("Feed no encontrado");

  let imported = 0;
  let skipped = 0;
  let errorMsg: string | null = null;

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
      const startDate = event.startDate.toJSDate();
      const endDate = event.endDate.toJSDate();
      const summary = event.summary ?? "";

      // Skip blocks (Airbnb often marks "Not available" blocks)
      const isBlock = /not available|blocked|unavailable|closed/i.test(summary);

      // Check if exists
      const { data: existing } = await admin
        .from("bookings")
        .select("id")
        .eq("source", feed.source as BookingSource)
        .eq("external_id", uid)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      const { error: insertError } = await admin.from("bookings").insert({
        organization_id: organization.id,
        unit_id: feed.unit_id,
        source: feed.source as BookingSource,
        external_id: uid,
        status: isBlock ? "confirmada" : "confirmada",
        check_in_date: startDate.toISOString().slice(0, 10),
        check_in_time: "15:00",
        check_out_date: endDate.toISOString().slice(0, 10),
        check_out_time: "11:00",
        currency: "ARS",
        total_amount: 0,
        notes: isBlock ? "Bloqueo (sin reserva real)" : `Importado de ${feed.source}: ${summary}`,
        guests_count: 1,
      });

      if (!insertError) imported++;
      else if (insertError.message.includes("bookings_no_overlap")) skipped++;
    }

    await admin
      .from("ical_feeds")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
        events_imported_count: feed.events_imported_count + imported,
      })
      .eq("id", feedId);
  } catch (e) {
    errorMsg = (e as Error).message;
    await admin
      .from("ical_feeds")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "error",
        last_sync_error: errorMsg,
      })
      .eq("id", feedId);
    throw new Error(errorMsg);
  }

  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  return { imported, skipped };
}

export async function syncAllFeeds(): Promise<{ totalImported: number; totalSkipped: number; errors: number }> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("active", true);

  let totalImported = 0;
  let totalSkipped = 0;
  let errors = 0;
  for (const f of feeds ?? []) {
    try {
      const r = await syncIcalFeed(f.id);
      totalImported += r.imported;
      totalSkipped += r.skipped;
    } catch {
      errors++;
    }
  }
  return { totalImported, totalSkipped, errors };
}
