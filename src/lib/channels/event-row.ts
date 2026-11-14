import type { Channel, ReservationEvent } from "./types";

/**
 * Reconstruye el ReservationEvent desde una fila de channel_events.
 *
 * Vive aparte (y no en dispatch.ts, que lo re-exporta) porque lo usan las dos
 * mitades del pipeline: el reconciliador y el botón "Reintentar" para
 * reprocesar, e ingest.ts para rescatar una confirmación por email que llegó
 * antes que el iCal. dispatch.ts ya importa ingest.ts; sin este módulo, ingest
 * tendría que importar dispatch y quedaba un ciclo.
 */
export function reservationEventFromRow(row: {
  organization_id: string;
  dedupe_key: string;
  content_hash: string | null;
  transport: string;
  event_type: string;
  payload: Record<string, unknown>;
}): ReservationEvent | null {
  const p = row.payload ?? {};
  const channel = p.channel as Channel | undefined;
  if (!channel || (channel !== "airbnb" && channel !== "booking")) return null;
  return {
    transport: (row.transport as "ical" | "email") ?? "ical",
    channel,
    eventType:
      row.event_type === "reservation_cancelled"
        ? "reservation_cancelled"
        : row.event_type === "reservation_reference"
          ? "reservation_reference"
          : "reservation_upsert",
    organizationId: row.organization_id,
    linkId: (p.link_id as string) ?? undefined,
    unitId: (p.unit_id as string) ?? undefined,
    icalUid: (p.ical_uid as string) ?? undefined,
    confirmationCode: (p.confirmation_code as string) ?? undefined,
    checkIn: (p.check_in as string) ?? undefined,
    checkOut: (p.check_out as string) ?? undefined,
    isBlock: Boolean(p.is_block),
    // Sin esto, todo replay (botón "Reintentar", reintento del reconcile)
    // pierde la única evidencia que autoriza a escribir en `bookings`.
    confirmed: p.confirmed === true,
    listingId: (p.listing_id as string) ?? undefined,
    listingHint: (p.listing_hint as string) ?? undefined,
    guest: {
      name: (p.guest_name as string) ?? undefined,
      email: (p.guest_email as string) ?? undefined,
      phone: (p.guest_phone as string) ?? undefined,
    },
    amounts: (p.amounts as { total?: number; currency?: string }) ?? undefined,
    dedupeKey: row.dedupe_key,
    contentHash: row.content_hash ?? undefined,
  };
}
