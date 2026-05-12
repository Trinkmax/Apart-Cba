import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { sendGuestMail } from "@/lib/email/guest";
import { plainTextToHtml } from "@/lib/email/render";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

/** Notifica al host (org) que llegó una nueva reserva o solicitud del marketplace. */
export async function notifyHostNewBooking(params: {
  organizationId: string;
  bookingId: string;
  unitId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  total: number;
  currency: string;
  isRequest?: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const noteTitle = params.isRequest
    ? "Nueva solicitud de reserva (marketplace)"
    : "Nueva reserva confirmada (marketplace)";
  const noteBody = params.isRequest
    ? `${params.guestName} solicitó ${params.checkIn} → ${params.checkOut} por ${params.currency} ${params.total.toLocaleString("es-AR")}. Aprobá o rechazá antes de 48 hs.`
    : `${params.guestName} reservó ${params.checkIn} → ${params.checkOut} por ${params.currency} ${params.total.toLocaleString("es-AR")}.`;

  await admin.from("notifications").insert({
    organization_id: params.organizationId,
    type: params.isRequest ? "manual" : "manual",
    severity: params.isRequest ? "warning" : "success",
    title: noteTitle,
    body: noteBody,
    ref_type: params.isRequest ? "booking_request" : "booking",
    ref_id: params.bookingId,
    target_role: "admin",
    action_url: params.isRequest
      ? `/dashboard/reservas-pendientes/${params.bookingId}`
      : `/dashboard/reservas/${params.bookingId}`,
    dedup_key: `mkt:${params.isRequest ? "req" : "bk"}:${params.bookingId}`,
  });

  // Email al contact_email de la org (si está configurado)
  const { data: org } = await admin
    .from("organizations")
    .select("contact_email, name")
    .eq("id", params.organizationId)
    .maybeSingle();

  if (org?.contact_email) {
    const subject = params.isRequest
      ? `Solicitud de reserva — ${params.guestName}`
      : `Nueva reserva — ${params.guestName}`;
    const link = `${APP_URL}${
      params.isRequest
        ? `/dashboard/reservas-pendientes/${params.bookingId}`
        : `/dashboard/reservas/${params.bookingId}`
    }`;
    const body = `${noteBody}\n\nVerla en el panel: ${link}`;
    await sendGuestMail({
      organizationId: params.organizationId,
      to: org.contact_email,
      subject,
      html: plainTextToHtml(body),
      text: body,
    });
  }
}

/** Confirmación al huésped por email (y WhatsApp si la org tiene CRM channel activo). */
export async function notifyGuestBookingConfirmed(params: {
  bookingId: string;
  guestEmail: string;
  guestPhone: string | null;
  guestName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `
        id, check_in_date, check_out_date, total_amount, currency, organization_id,
        unit:units(name, marketplace_title, address, neighborhood, slug),
        organization:organizations(name, contact_email, contact_phone)
      `
    )
    .eq("id", params.bookingId)
    .maybeSingle();
  if (!booking) return;

  const unit = booking.unit as unknown as {
    name: string;
    marketplace_title: string | null;
    address: string | null;
    neighborhood: string | null;
    slug: string | null;
  };
  const org = booking.organization as unknown as {
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
  };

  const title = unit.marketplace_title ?? unit.name;
  const where = unit.neighborhood || unit.address || "";
  const total = `${booking.currency} ${Number(booking.total_amount).toLocaleString("es-AR")}`;

  const subject = `¡Tu reserva está confirmada en rentOS! — ${title}`;
  const body = `Hola ${params.guestName},

¡Listo! Tu reserva está confirmada.

  Propiedad: ${title}${where ? `\n  Ubicación: ${where}` : ""}
  Check-in: ${booking.check_in_date}
  Check-out: ${booking.check_out_date}
  Total: ${total}
  Anfitrión: ${org.name}

Podés ver el detalle y contactar al anfitrión en cualquier momento:
${APP_URL}/mi-cuenta/reservas/${booking.id}

Gracias por reservar con rentOS — esperamos que tengas una gran estadía.

— Equipo rentOS`;

  await sendGuestMail({
    organizationId: booking.organization_id,
    to: params.guestEmail,
    subject,
    html: plainTextToHtml(body),
    text: body,
    replyTo: org.contact_email ?? undefined,
  });

  // WhatsApp (best-effort, requiere CRM channel activo)
  if (params.guestPhone) {
    await sendWhatsAppIfPossible({
      organizationId: booking.organization_id,
      phone: params.guestPhone,
      message: `Hola ${params.guestName}, tu reserva en ${title} está confirmada del ${booking.check_in_date} al ${booking.check_out_date}. Total: ${total}. Detalles: ${APP_URL}/mi-cuenta/reservas/${booking.id}`,
    });
  }
}

export async function notifyGuestRequestApproved(params: {
  requestId: string;
  bookingId: string;
  guestEmail: string;
  guestPhone: string | null;
  guestName: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `id, organization_id, unit:units(marketplace_title, name), organization:organizations(name)`
    )
    .eq("id", params.bookingId)
    .maybeSingle();
  if (!booking) return;

  const unit = booking.unit as unknown as { marketplace_title: string | null; name: string };
  const org = booking.organization as unknown as { name: string };
  const title = unit.marketplace_title ?? unit.name;

  const subject = `¡Tu solicitud fue aprobada! — ${title}`;
  const body = `Hola ${params.guestName},

¡Buenas noticias! ${org.name} aprobó tu solicitud para hospedarte en ${title}.

Tu reserva está confirmada. Podés ver el detalle acá:
${APP_URL}/mi-cuenta/reservas/${booking.id}

— Equipo rentOS`;

  await sendGuestMail({
    organizationId: booking.organization_id,
    to: params.guestEmail,
    subject,
    html: plainTextToHtml(body),
    text: body,
  });

  if (params.guestPhone) {
    await sendWhatsAppIfPossible({
      organizationId: booking.organization_id,
      phone: params.guestPhone,
      message: `¡Hola ${params.guestName}! Tu solicitud para hospedarte en ${title} fue aprobada. Mirá los detalles: ${APP_URL}/mi-cuenta/reservas/${booking.id}`,
    });
  }
}

export async function notifyGuestRequestRejected(params: {
  requestId: string;
  guestEmail: string;
  guestPhone: string | null;
  guestName: string;
  reason: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("booking_requests")
    .select(
      `organization_id, unit:units(marketplace_title, name, slug), organization:organizations(name)`
    )
    .eq("id", params.requestId)
    .maybeSingle();
  if (!req) return;

  const unit = req.unit as unknown as {
    marketplace_title: string | null;
    name: string;
    slug: string | null;
  };
  const org = req.organization as unknown as { name: string };
  const title = unit.marketplace_title ?? unit.name;

  const subject = `Sobre tu solicitud en ${title}`;
  const body = `Hola ${params.guestName},

${org.name} no pudo confirmar tu solicitud para ${title}.

Motivo: ${params.reason}

¡No te preocupes! Tenemos muchas otras propiedades increíbles esperándote:
${APP_URL}/buscar

— Equipo rentOS`;

  await sendGuestMail({
    organizationId: req.organization_id,
    to: params.guestEmail,
    subject,
    html: plainTextToHtml(body),
    text: body,
  });

  if (params.guestPhone) {
    await sendWhatsAppIfPossible({
      organizationId: req.organization_id,
      phone: params.guestPhone,
      message: `Hola ${params.guestName}, no pudimos confirmar tu solicitud en ${title}. Motivo: ${params.reason}. Mirá otras opciones: ${APP_URL}/buscar`,
    });
  }
}

/**
 * Envia un mensaje de WhatsApp si la org tiene un CRM channel activo de tipo
 * meta_cloud. No usamos templates pre-aprobados, simplemente publish un evento
 * CRM que el sistema existente puede tomar. Si no hay channel, no-op.
 */
async function sendWhatsAppIfPossible(params: {
  organizationId: string;
  phone: string;
  message: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: channel } = await admin
      .from("crm_channels")
      .select("id, provider, status")
      .eq("organization_id", params.organizationId)
      .eq("provider", "meta_cloud")
      .eq("status", "active")
      .maybeSingle();
    if (!channel) return;

    // Publicar evento CRM que el sistema de workflows pueda tomar
    await admin.from("crm_events").insert({
      organization_id: params.organizationId,
      event_type: "marketplace.outbound_message",
      payload: {
        channel_id: channel.id,
        phone: params.phone,
        message: params.message,
      },
    });
  } catch (e) {
    console.warn("[notifications] WhatsApp skip:", e);
  }
}
