// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = import("@supabase/supabase-js").SupabaseClient<any, any, any>;
import type { ParsedEvent, ParsedBookingEvent, ParsedCancellationEvent } from "./types";
import { matchUnit, matchUnitByListingId, findOrCreateGuest } from "./matcher";

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

  // 1) Lookup determinístico contra ota_listings si el parser extrajo el listing_id
  let unitId: string | null = await matchUnitByListingId(
    admin,
    orgId,
    event.source,
    event.externalListingId,
  );

  // 2) Fuzzy match contra units.name / marketplace_title como fallback
  if (!unitId) {
    const unitMatch = await matchUnit(admin, orgId, event.listingHint);
    unitId = unitMatch?.unitId ?? null;
  }

  // 3) Último fallback: si la org tiene una sola feed iCal activa para este source, usar esa unidad
  if (!unitId) {
    const { data: feeds } = await admin
      .from("ical_feeds")
      .select("unit_id")
      .eq("organization_id", orgId)
      .eq("source", event.source)
      .eq("active", true)
      .limit(2);
    if (feeds && feeds.length === 1) {
      unitId = feeds[0].unit_id;
    }
  }

  if (!unitId) {
    await insertNotification(admin, {
      organization_id: orgId,
      type: "inbound_booking_unmatched_unit",
      severity: "warning",
      title: `Reserva ${event.source} sin unidad asignada`,
      body: `Llegó una reserva de ${event.source} (${event.externalId}) pero no pude determinar a qué unidad corresponde. ${
        event.listingHint ? `El listing dice: "${event.listingHint}". ` : ""
      }Mapeá el listing en Channel Manager → Mapeo.`,
      target_role: "admin",
      action_url: "/dashboard/channel-manager",
      dedup_key: `inbound_unmatched:${event.source}:${event.externalId}`,
    });
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
      status: "confirmada",
      mode: "temporario",
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
      await insertNotification(admin, {
        organization_id: orgId,
        type: "inbound_booking_conflict",
        severity: "critical",
        title: `Conflicto de fechas con ${event.source}`,
        body: `La reserva de ${event.source} (${event.externalId}) para ${event.checkIn}→${event.checkOut} se superpone con otra reserva existente en la misma unidad. Resolvé manualmente.`,
        target_role: "admin",
        action_url: "/dashboard/reservas",
        dedup_key: `inbound_conflict:${event.source}:${event.externalId}`,
      });
      return { action: "error", error: "Conflicto: ya hay una reserva en esa unidad para esas fechas" };
    }
    return { action: "error", error: insertError.message };
  }

  await insertNotification(admin, {
    organization_id: orgId,
    type: "inbound_booking_pending",
    severity: "info",
    title: `Nueva reserva de ${event.source}`,
    body: `${event.guestName} · ${event.checkIn} → ${event.checkOut}${
      event.totalAmount ? ` · ${event.currency ?? "ARS"} ${event.totalAmount}` : ""
    }`,
    ref_type: "booking",
    ref_id: booking.id,
    target_role: "admin",
    action_url: `/dashboard/reservas/${booking.id}`,
    dedup_key: `inbound_new:${event.source}:${event.externalId}`,
  });

  return { action: "created", bookingId: booking.id };
}

async function handleCancellation(
  admin: AdminClient,
  orgId: string,
  event: ParsedCancellationEvent
): Promise<HandleResult> {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status, check_in_date, check_out_date, unit_id")
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

  await insertNotification(admin, {
    organization_id: orgId,
    type: "inbound_booking_cancelled",
    severity: "warning",
    title: `Cancelación en ${event.source}`,
    body: `La reserva ${event.externalId} (${booking.check_in_date} → ${booking.check_out_date}) fue cancelada en ${event.source}.`,
    ref_type: "booking",
    ref_id: booking.id,
    target_role: "admin",
    action_url: `/dashboard/reservas/${booking.id}`,
    dedup_key: `inbound_cancel:${event.source}:${event.externalId}`,
  });

  return { action: "cancelled", bookingId: booking.id };
}

interface NotificationInsert {
  organization_id: string;
  type:
    | "inbound_booking_pending"
    | "inbound_booking_cancelled"
    | "inbound_booking_unmatched_unit"
    | "inbound_booking_conflict"
    | "channel_feed_error";
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  ref_type?: string;
  ref_id?: string;
  target_role?: "admin" | "recepcion" | "mantenimiento" | "limpieza" | "owner_view";
  action_url?: string;
  dedup_key?: string;
}

/**
 * Insert con dedup_key — si ya existe una notification con la misma clave no
 * se inserta. La unique index uniq_notifications_dedup hace el guard.
 */
async function insertNotification(admin: AdminClient, n: NotificationInsert): Promise<void> {
  const { error } = await admin.from("notifications").insert(n);
  if (error && error.code !== "23505") {
    console.error("[inbound:notification]", error);
  }
}
