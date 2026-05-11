"use server";

import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { createAdminClient } from "@/lib/supabase/server";
import { buildBookingContext, getRenderedBookingTemplate } from "@/lib/email/booking-templates";

/**
 * Server action que arma el "preview" del booking para el dialog y además
 * renderiza el template default. Devuelve todo en una sola roundtrip para
 * minimizar latencia al abrir el dialog.
 */
export async function getBookingConfirmationPreview(bookingId: string): Promise<
  | {
      ok: true;
      preview: {
        id: string;
        guest_full_name: string;
        guest_email: string | null;
        unit_name: string;
        check_in_date: string;
        check_out_date: string;
      };
      template: { subject: string | null; body: string } | null;
    }
  | { ok: false; error: string }
> {
  await requireSession();
  const { organization } = await getCurrentOrg();

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `
      id,
      check_in_date,
      check_out_date,
      guest:guests(full_name, email),
      unit:units(name)
    `
    )
    .eq("id", bookingId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Reserva no encontrada" };

  // PostgREST embedded resources type-cast: arrays normalized vía `as unknown` step.
  const guest = booking.guest as unknown as
    | { full_name: string; email: string | null }
    | null;
  const unit = booking.unit as unknown as { name: string } | null;

  const ctx = await buildBookingContext(bookingId);
  const template = ctx
    ? await getRenderedBookingTemplate({
        organizationId: ctx.organizationId,
        eventType: "booking_confirmed",
        channel: "email",
        variables: ctx.variables,
      })
    : null;

  return {
    ok: true,
    preview: {
      id: booking.id as string,
      guest_full_name: guest?.full_name ?? "Huésped",
      guest_email: guest?.email ?? null,
      unit_name: unit?.name ?? "",
      check_in_date: booking.check_in_date as string,
      check_out_date: booking.check_out_date as string,
    },
    template,
  };
}
