"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { isStillPublished, type PublishedRow } from "@/lib/channels/still-published";
import { todayYmdInTz } from "@/lib/dates";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";

export interface OtaStillPublishing {
  channel: "airbnb" | "booking";
  /** Última vez que se la vio en el calendario de la OTA (ISO). */
  seenAt: string;
}

/**
 * Antes de cancelar a mano una reserva: ¿la OTA la sigue publicando?
 *
 * Lo consulta el menú de estado en el paso de confirmación. Devuelve `null` si
 * la reserva no vino de un canal, si la OTA ya no la muestra, o si no se pudo
 * saber: un aviso que falta no puede trabar una cancelación.
 */
export async function getOtaStillPublishing(bookingId: string): Promise<OtaStillPublishing | null> {
  try {
    await requireSession();
    const { organization } = await getCurrentOrg();
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
    const admin = createAdminClient();
    const { data } = await admin
      .from("channel_reservations")
      .select("channel, external_status, ical_uid, last_seen_at, missing_since, check_out, is_block")
      .eq("organization_id", organization.id)
      .eq("booking_id", bookingId)
      .eq("external_status", "active")
      .limit(5);
    const today = todayYmdInTz();
    const live = ((data ?? []) as (PublishedRow & { channel: "airbnb" | "booking" })[]).find(
      (r) => !r.is_block && isStillPublished(r, today),
    );
    return live?.last_seen_at ? { channel: live.channel, seenAt: live.last_seen_at } : null;
  } catch {
    return null;
  }
}
