import {
  findSameListing,
  SAME_LISTING_FRESH_MS,
  SAME_LISTING_MAX_UIDS,
  type OtherLinkRow,
  type SameListingClash,
} from "./same-listing";
import type { Channel } from "./types";
import { unitDisplay } from "./unit-label";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;

export type SameListingConnection = SameListingClash & { unitCode: string; unitLabel: string };

/**
 * La otra conexión (mismo canal, misma organización) que está leyendo AHORA
 * alguna de las entradas de un calendario que se quiere cargar. La regla está
 * en same-listing.ts; acá está la lectura.
 *
 * Nunca frena por un error propio: si no se pudo consultar devuelve `null`, y
 * el enlace (que puede estar bien) se guarda.
 */
export async function findSameListingConnection(
  admin: AdminClient,
  input: { organizationId: string; channel: Channel; linkId: string; feedUids: string[] },
  nowMs: number = Date.now(),
): Promise<SameListingConnection | null> {
  const uids = input.feedUids.slice(0, SAME_LISTING_MAX_UIDS);
  if (uids.length === 0) return null;
  const { data, error } = await admin
    .from("channel_reservations")
    .select("link_id, unit_id, ical_uid, check_in, check_out, last_seen_at")
    .eq("organization_id", input.organizationId)
    .eq("channel", input.channel)
    .neq("link_id", input.linkId)
    .in("ical_uid", uids)
    .gt("last_seen_at", new Date(nowMs - SAME_LISTING_FRESH_MS).toISOString());
  if (error) return null;
  const clash = findSameListing(uids, (data ?? []) as OtherLinkRow[], nowMs);
  if (!clash) return null;

  // Sólo cuenta una conexión que sigue activa: una pausada ya no lee nada, y
  // pausarla es justamente la salida cuando la equivocada es ésa.
  const { data: other } = await admin
    .from("channel_links")
    .select("status, unit_id")
    .eq("id", clash.linkId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!other || other.status !== "active") return null;
  const { data: unit } = await admin
    .from("units")
    .select("code, name")
    .eq("id", other.unit_id as string)
    .maybeSingle();
  const unitCode = (unit?.code as string | undefined) ?? "otro departamento";
  const unitLabel = unitDisplay(unitCode, unit?.name as string | undefined);
  return { ...clash, unitCode, unitLabel };
}
