"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import type { BookingRequestWithRelations } from "@/lib/types/database";
import {
  notifyGuestRequestApproved,
  notifyGuestRequestRejected,
} from "@/lib/marketplace/notifications";

export async function listBookingRequestsForOrg(opts?: {
  status?: "pendiente" | "aprobada" | "rechazada" | "expirada" | "cancelada";
}): Promise<BookingRequestWithRelations[]> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  let q = admin
    .from("booking_requests")
    .select(
      `*, unit:units(id, code, name, slug, marketplace_title), organization:organizations(id, name)`
    )
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  if (opts?.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as BookingRequestWithRelations[];
}

export async function getBookingRequest(id: string): Promise<BookingRequestWithRelations | null> {
  await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_requests")
    .select(
      `*, unit:units(id, code, name, slug, marketplace_title), organization:organizations(id, name)`
    )
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BookingRequestWithRelations | null) ?? null;
}

export async function approveBookingRequest(
  id: string,
  options?: { internal_note?: string | null }
): Promise<{ ok: true; booking_id: string } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();

  // 1) Cargar la request
  const { data: req, error: reqErr } = await admin
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (reqErr) return { ok: false, error: reqErr.message };
  if (!req) return { ok: false, error: "Solicitud no encontrada" };
  if (req.status !== "pendiente") {
    return { ok: false, error: "La solicitud ya no está pendiente" };
  }
  if (new Date(req.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "La solicitud ya expiró" };
  }

  // 2) Crear / encontrar el huésped en la org
  let guestId: string | null = null;
  const { data: existingGuest } = await admin
    .from("guests")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("email", req.guest_email)
    .maybeSingle();
  if (existingGuest) {
    guestId = existingGuest.id;
  } else {
    const { data: created, error: gErr } = await admin
      .from("guests")
      .insert({
        organization_id: organization.id,
        full_name: req.guest_full_name,
        email: req.guest_email,
        phone: req.guest_phone,
        document_number: req.guest_document,
      })
      .select("id")
      .single();
    if (gErr) return { ok: false, error: `Error creando huésped: ${gErr.message}` };
    guestId = created.id;
  }

  // 3) Crear booking
  const { data: booking, error: bkErr } = await admin
    .from("bookings")
    .insert({
      organization_id: organization.id,
      unit_id: req.unit_id,
      guest_id: guestId,
      source: "directo",
      status: "confirmada",
      mode: "temporario",
      check_in_date: req.check_in_date,
      check_in_time: req.check_in_time,
      check_out_date: req.check_out_date,
      check_out_time: req.check_out_time,
      guests_count: req.guests_count,
      currency: req.currency,
      total_amount: req.total_amount,
      paid_amount: 0,
      cleaning_fee: req.cleaning_fee ?? 0,
      notes: req.special_requests,
      internal_notes: options?.internal_note
        ? `Aprobada desde solicitud ${id}. ${options.internal_note}`
        : `Aprobada desde solicitud ${id}`,
      created_by: session.userId,
    })
    .select()
    .single();

  if (bkErr) {
    if (bkErr.message.includes("bookings_no_overlap")) {
      return {
        ok: false,
        error: "Hay un conflicto con otra reserva. Rechazá la solicitud o ajustá las fechas.",
      };
    }
    return { ok: false, error: bkErr.message };
  }

  // 4) Marcar request como aprobada
  await admin
    .from("booking_requests")
    .update({
      status: "aprobada",
      approved_at: new Date().toISOString(),
      approved_by: session.userId,
      resulting_booking_id: booking.id,
    })
    .eq("id", id);

  // 5) Notificar al huésped
  try {
    await notifyGuestRequestApproved({
      requestId: id,
      bookingId: booking.id,
      guestEmail: req.guest_email,
      guestPhone: req.guest_phone,
      guestName: req.guest_full_name,
    });
  } catch (e) {
    console.warn("[booking-requests] notificación falló:", e);
  }

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath("/dashboard/reservas");
  revalidatePath("/dashboard/unidades/kanban");
  revalidatePath("/mi-cuenta");

  return { ok: true, booking_id: booking.id };
}

export async function rejectBookingRequest(
  id: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  const { organization } = await getCurrentOrg();
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { ok: false, error: "Necesitamos al menos una breve razón (5 caracteres)" };
  }
  const admin = createAdminClient();
  const { data: req, error: reqErr } = await admin
    .from("booking_requests")
    .select("guest_email, guest_phone, guest_full_name, status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (reqErr) return { ok: false, error: reqErr.message };
  if (!req) return { ok: false, error: "Solicitud no encontrada" };
  if (req.status !== "pendiente") {
    return { ok: false, error: "La solicitud ya no está pendiente" };
  }

  const { error } = await admin
    .from("booking_requests")
    .update({
      status: "rechazada",
      rejected_at: new Date().toISOString(),
      rejected_by: session.userId,
      rejection_reason: trimmed,
    })
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) return { ok: false, error: error.message };

  try {
    await notifyGuestRequestRejected({
      requestId: id,
      guestEmail: req.guest_email,
      guestPhone: req.guest_phone,
      guestName: req.guest_full_name,
      reason: trimmed,
    });
  } catch (e) {
    console.warn("[booking-requests] notificación falló:", e);
  }

  revalidatePath("/dashboard/reservas-pendientes");
  revalidatePath("/mi-cuenta");
  return { ok: true };
}

export async function countPendingRequestsForOrg(): Promise<number> {
  const { organization } = await getCurrentOrg();
  const admin = createAdminClient();
  const { count } = await admin
    .from("booking_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization.id)
    .eq("status", "pendiente")
    .gt("expires_at", new Date().toISOString());
  return count ?? 0;
}
