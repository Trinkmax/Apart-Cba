// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { ParsedEvent, ParsedBookingEvent, ParsedCancellationEvent } from "./types";
import { matchUnit, findOrCreateGuest } from "./matcher";

export interface HandleResult {
  action: "created" | "cancelled" | "duplicate" | "error";
  bookingId?: string;
  error?: string;
}

export async function handleInboundEvent(
  admin: AdminClient,
  orgId: string,
  event: ParsedEvent
): Promise<HandleResult> {
  if (event.type === "new_booking") {
    return handleNewBooking(admin, orgId, event);
  }
  return handleCancellation(admin, orgId, event);
}

async function handleNewBooking(
  admin: AdminClient,
  orgId: string,
  event: ParsedBookingEvent
): Promise<HandleResult> {
  // Dedup by (org, source, external_id)
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("organization_id", orgId)
    .eq("source", event.source)
    .eq("external_id", event.externalId)
    .maybeSingle();
  if (existing) {
    return { action: "duplicate", bookingId: existing.id };
  }

  // Match unit
  const unitMatch = await matchUnit(admin, orgId, event.listingHint);
  let unitId: string | null = unitMatch?.unitId ?? null;

  // If no match, try to find a unit from an existing iCal feed for this source
  if (!unitId) {
    const { data: feed } = await admin
      .from("ical_feeds")
      .select("unit_id")
      .eq("organization_id", orgId)
      .eq("source", event.source)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    unitId = feed?.unit_id ?? null;
  }

  if (!unitId) {
    return { action: "error", error: "No se pudo determinar la unidad para esta reserva" };
  }

  // Resolve/create guest
  const guestId = await findOrCreateGuest(admin, orgId, event);

  // Insert booking
  const { data: booking, error: insertError } = await admin
    .from("bookings")
    .insert({
      organization_id: orgId,
      unit_id: unitId,
      guest_id: guestId,
      source: event.source,
      external_id: event.externalId,
      status: "pendiente",
      check_in_date: event.checkIn,
      check_in_time: "14:00",
      check_out_date: event.checkOut,
      check_out_time: "10:00",
      currency: event.currency ?? "ARS",
      total_amount: event.totalAmount ?? 0,
      notes: `Importado desde email de ${event.source}`,
      guests_count: 1,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.message.includes("bookings_no_overlap")) {
      return { action: "error", error: "Conflicto: ya hay una reserva en esa unidad para esas fechas" };
    }
    return { action: "error", error: insertError.message };
  }

  return { action: "created", bookingId: booking.id };
}

async function handleCancellation(
  admin: AdminClient,
  orgId: string,
  event: ParsedCancellationEvent
): Promise<HandleResult> {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("source", event.source)
    .eq("external_id", event.externalId)
    .maybeSingle();

  if (!booking) {
    return { action: "error", error: `Reserva ${event.externalId} no encontrada para cancelar` };
  }

  if (booking.status === "cancelada") {
    return { action: "duplicate", bookingId: booking.id };
  }

  const { error } = await admin
    .from("bookings")
    .update({
      status: "cancelada",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: `Cancelación recibida por email de ${event.source}`,
    })
    .eq("id", booking.id);

  if (error) {
    return { action: "error", error: error.message };
  }

  return { action: "cancelled", bookingId: booking.id };
}
