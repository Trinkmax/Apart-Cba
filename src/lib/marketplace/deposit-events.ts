import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { reservationPath } from "./access-token";
import { notifyDepositRegistered } from "./notifications";
import { isSenaCovered, resolveBookingSena } from "./sena";

/**
 * Cierre del circuito de la seña de una reserva que vino de la web.
 *
 * Se llama cada vez que cambia lo cobrado de una reserva (un cobro registrado
 * en Caja con addBookingPayment, o el equipo que marca como registrado el "Ya
 * transferí" del huésped). Si la seña quedó cubierta:
 *   1. los avisos de pago del huésped que seguían pendientes pasan a
 *      "registrado" (el equipo no tiene que marcarlos uno por uno);
 *   2. el huésped recibe "Reserva asegurada" UNA sola vez: se reclama
 *      `booking_requests.deposit_secured_at` con un update condicional, así que
 *      aunque se llame desde los dos lugares, el mail sale una vez.
 *
 * No toca Caja ni `paid_amount`: sólo lee lo cobrado. Nunca lanza.
 */
export async function secureDepositIfCovered(p: {
  bookingId: string;
  organizationId: string;
  actorUserId?: string | null;
}): Promise<{ secured: boolean; emailSent: boolean }> {
  const none = { secured: false, emailSent: false };
  try {
    const admin = createAdminClient();
    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("id, organization_id, status, paid_amount, deposit_amount")
      .eq("id", p.bookingId)
      .eq("organization_id", p.organizationId)
      .maybeSingle();
    if (bErr || !booking) return none;
    if (booking.status === "cancelada" || booking.status === "no_show") return none;

    // Sólo reservas que vinieron de la web (tienen su solicitud con link).
    const { data: request } = await admin
      .from("booking_requests")
      .select("id, deposit_estimate")
      .eq("resulting_booking_id", booking.id)
      .eq("organization_id", p.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!request) return none;

    const sena = resolveBookingSena({
      depositAmount: booking.deposit_amount as number | null,
      estimate: request.deposit_estimate as number | null,
      fallback: null,
    });
    if (sena == null || !isSenaCovered(Number(booking.paid_amount ?? 0), sena)) return none;

    const now = new Date().toISOString();
    await admin
      .from("booking_payment_reports")
      .update({ status: "registrado", reviewed_by: p.actorUserId ?? null, reviewed_at: now })
      .eq("booking_id", booking.id)
      .eq("organization_id", p.organizationId)
      .eq("status", "pendiente");

    const { data: claimed } = await admin
      .from("booking_requests")
      .update({ deposit_secured_at: now })
      .eq("id", request.id)
      .is("deposit_secured_at", null)
      .select("id");

    let emailSent = false;
    if (claimed && claimed.length > 0) {
      emailSent = (await notifyDepositRegistered({ requestId: request.id, bookingId: booking.id })).emailSent;
    }

    for (const path of [
      reservationPath(request.id),
      "/mi-cuenta",
      "/dashboard/reservas-pendientes",
      `/dashboard/reservas/${booking.id}`,
    ]) {
      try {
        revalidatePath(path);
      } catch {
        // fuera de un request (p. ej. después de responder): no hay caché que invalidar.
      }
    }
    return { secured: true, emailSent };
  } catch (e) {
    console.warn("[deposit-events] secureDepositIfCovered:", p.bookingId, e);
    return none;
  }
}
