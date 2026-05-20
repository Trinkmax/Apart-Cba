"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "./org";
import { requireSession } from "./auth";
import { syncSingleFeed } from "@/lib/ical/sync";
import type {
  IcalFeed,
  IcalFeedWithHealth,
  IcalFeedHealthStatus,
  IcalSyncRun,
  Unit,
} from "@/lib/types/database";

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

export async function listIcalFeedsWithHealth(): Promise<IcalFeedWithHealth[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const [{ data: feeds, error: feedsErr }, { data: healthRows, error: healthErr }] =
    await Promise.all([
      admin
        .from("ical_feeds")
        .select(`*, unit:units(id, code, name)`)
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false }),
      admin
        .from("ical_feed_health")
        .select("*")
        .eq("organization_id", organization.id),
    ]);

  if (feedsErr) throw new Error(feedsErr.message);
  if (healthErr) throw new Error(healthErr.message);

  const healthMap = new Map(
    (healthRows ?? []).map((h: { feed_id: string; health: string; errors_24h: number; last_ok_at: string | null }) => [h.feed_id, h])
  );

  return (feeds ?? []).map((f: IcalFeed & { unit: Pick<Unit, "id" | "code" | "name"> }) => {
    const h = healthMap.get(f.id);
    return {
      ...f,
      health: (h?.health ?? "ok") as IcalFeedHealthStatus,
      errors_24h: h?.errors_24h ?? 0,
      last_ok_at: h?.last_ok_at ?? null,
    };
  });
}

export async function createIcalFeed(input: IcalFeedInput) {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const validated = feedSchema.parse(input);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("ical_feeds")
    .insert({ ...validated, organization_id: organization.id })
    .select("id, organization_id, unit_id, source, feed_url, events_imported_count")
    .single();
  if (error) throw new Error(error.message);

  // Sync inmediato de prueba — si falla, eliminamos el feed
  const result = await syncSingleFeed(admin, data, "create_feed");
  if (result.error) {
    await admin.from("ical_feeds").delete().eq("id", data.id);
    throw new Error(`Feed inválido: ${result.error}`);
  }

  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  return data as unknown as IcalFeed;
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

export async function syncIcalFeed(feedId: string): Promise<{ imported: number; skipped: number }> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const { data: feed } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, events_imported_count")
    .eq("id", feedId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!feed) throw new Error("Feed no encontrado");

  const result = await syncSingleFeed(admin, feed, "manual");
  if (result.error) throw new Error(result.error);

  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  return { imported: result.imported, skipped: result.skipped };
}

export async function syncAllFeeds(): Promise<{ totalImported: number; totalSkipped: number; errors: number }> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data: feeds } = await admin
    .from("ical_feeds")
    .select("id, organization_id, unit_id, source, feed_url, events_imported_count")
    .eq("organization_id", organization.id)
    .eq("active", true);

  let totalImported = 0;
  let totalSkipped = 0;
  let errors = 0;
  for (const f of feeds ?? []) {
    const r = await syncSingleFeed(admin, f, "manual");
    totalImported += r.imported;
    totalSkipped += r.skipped;
    if (r.error) errors++;
  }

  revalidatePath("/dashboard/channel-manager");
  revalidatePath("/dashboard/reservas");
  return { totalImported, totalSkipped, errors };
}

export async function getSyncRunsForFeed(feedId: string, limit = 20): Promise<IcalSyncRun[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ical_sync_runs")
    .select("*")
    .eq("feed_id", feedId)
    .eq("organization_id", organization.id)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as IcalSyncRun[];
}

export async function getFeedHealthSummary(): Promise<{ broken: number; warning: number }> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ical_feed_health")
    .select("health")
    .eq("organization_id", organization.id);
  if (error) return { broken: 0, warning: 0 };
  let broken = 0;
  let warning = 0;
  for (const row of data ?? []) {
    if (row.health === "broken") broken++;
    else if (row.health === "warning") warning++;
  }
  return { broken, warning };
}

export type UnitExportRow = Pick<Unit, "id" | "code" | "name"> & {
  ical_export_token: string;
  export_url: string;
};

export async function listUnitExportFeeds(): Promise<UnitExportRow[]> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select("id, code, name, ical_export_token")
    .eq("organization_id", organization.id)
    .eq("active", true)
    .order("code");
  if (error) throw new Error(error.message);

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return (data ?? []).map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    ical_export_token: u.ical_export_token,
    export_url: `${base}/api/ical/${u.id}.ics?token=${u.ical_export_token}`,
  }));
}

export async function rotateExportToken(unitId: string): Promise<string> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await admin
    .from("units")
    .update({ ical_export_token: token })
    .eq("id", unitId)
    .eq("organization_id", organization.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/channel-manager");
  return token;
}
