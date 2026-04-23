import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Fluid Compute — hasta 5 min para sync masivo

/**
 * Sincroniza todos los feeds iCal activos de todas las organizaciones.
 * Idempotente — safe para correr 1x/día vía Vercel Cron (plan Hobby).
 */
export async function GET() {
  const admin = createAdminClient();
  const { data: feeds, error } = await admin
    .from("ical_feeds")
    .select("id, organization_id")
    .eq("active", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = { totalImported: 0, totalSkipped: 0, errors: 0 };
  for (const f of feeds ?? []) {
    try {
      // syncIcalFeed depende de getCurrentOrg que requiere session.
      // Para el cron, hacemos sync directo aquí inline.
      const { data: feed } = await admin.from("ical_feeds").select("*").eq("id", f.id).single();
      if (!feed) continue;
      const ICAL = (await import("ical.js")).default;
      const res = await fetch(feed.feed_url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        await admin.from("ical_feeds").update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "error",
          last_sync_error: `HTTP ${res.status}`,
        }).eq("id", f.id);
        results.errors++;
        continue;
      }
      const icsText = await res.text();
      const jcalData = ICAL.parse(icsText);
      const comp = new ICAL.Component(jcalData);
      const events = comp.getAllSubcomponents("vevent");
      let imported = 0;
      let skipped = 0;
      for (const ev of events) {
        const event = new ICAL.Event(ev);
        const uid = event.uid;
        const startDate = event.startDate.toJSDate();
        const endDate = event.endDate.toJSDate();
        const summary = event.summary ?? "";

        const { data: existing } = await admin
          .from("bookings")
          .select("id")
          .eq("source", feed.source)
          .eq("external_id", uid)
          .maybeSingle();
        if (existing) { skipped++; continue; }

        const { error: insertError } = await admin.from("bookings").insert({
          organization_id: feed.organization_id,
          unit_id: feed.unit_id,
          source: feed.source,
          external_id: uid,
          status: "confirmada",
          check_in_date: startDate.toISOString().slice(0, 10),
          check_in_time: "15:00",
          check_out_date: endDate.toISOString().slice(0, 10),
          check_out_time: "11:00",
          currency: "ARS",
          total_amount: 0,
          notes: `Importado de ${feed.source}: ${summary}`,
          guests_count: 1,
        });
        if (!insertError) imported++;
        else skipped++;
      }
      await admin.from("ical_feeds").update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
        events_imported_count: feed.events_imported_count + imported,
      }).eq("id", f.id);
      results.totalImported += imported;
      results.totalSkipped += skipped;
    } catch (e) {
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
