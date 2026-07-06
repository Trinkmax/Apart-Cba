import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { sendGuestMail } from "@/lib/email/guest";
import { plainTextToHtml } from "@/lib/email/render";
import { renderBookingConfirmationEmail } from "@/lib/email/booking-confirmation";

// .trim() + sin barra final: el env de Vercel puede venir con un salto de línea
// al final ("https://www.apartcba.com\n"), y sin esto el link del depto queda
// partido ("...com⏎/u/slug") y WhatsApp/clientes de correo lo cortan en ".com".
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001")
  .trim()
  .replace(/\/+$/, "");

/**
 * Escapa caracteres HTML de campos controlados por el usuario (ej. el nombre
 * del huésped) antes de interpolarlos en el HTML del email. El texto plano se
 * envía sin escapar. (render.ts tiene un helper equivalente pero no exportado.)
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
      html: plainTextToHtml(escapeHtml(body)),
      text: body,
    });
  }
}

/**
 * Carga el booking + relaciones y arma el render del email premium de
 * confirmación. Devuelve también el teléfono del huésped (para WhatsApp). null
 * si el booking no existe o el huésped no tiene email.
 */
async function buildConfirmationEmail(params: {
  bookingId: string;
}): Promise<{
  organizationId: string;
  to: string;
  replyTo: string | undefined;
  subject: string;
  html: string;
  text: string;
  guestPhone: string | null;
  guestFirstName: string;
  unitTitle: string;
  checkIn: string;
  checkOut: string;
  totalLabel: string;
  deposit: number | null;
} | null> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `
        id, check_in_date, check_out_date, total_amount, currency, guests_count, organization_id, deposit_amount,
        guest:guests(full_name, email, phone),
        unit:units(name, marketplace_title, slug),
        organization:organizations(name, logo_url, primary_color, contact_email, contact_phone)
      `
    )
    .eq("id", params.bookingId)
    .maybeSingle();
  if (!booking) return null;

  const guest = booking.guest as unknown as {
    full_name: string;
    email: string | null;
    phone: string | null;
  } | null;
  const unit = booking.unit as unknown as {
    name: string;
    marketplace_title: string | null;
    slug: string | null;
  } | null;
  const org = booking.organization as unknown as {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  } | null;

  if (!guest?.email) return null;

  const unitTitle = unit?.marketplace_title || unit?.name || "tu departamento";
  const listingUrl = unit?.slug ? `${APP_URL}/u/${unit.slug}` : null;
  const currency = String(booking.currency ?? "ARS");
  const total = Number(booking.total_amount ?? 0);
  const deposit =
    booking.deposit_amount != null ? Number(booking.deposit_amount) : null;

  const { subject, html, text } = renderBookingConfirmationEmail({
    guestName: guest.full_name ?? "",
    unitTitle,
    checkInIso: booking.check_in_date as string,
    checkOutIso: booking.check_out_date as string,
    guestsCount: Number(booking.guests_count ?? 1),
    currency,
    total,
    deposit,
    listingUrl,
    org: {
      name: org?.name ?? "",
      logoUrl: org?.logo_url ?? null,
      primaryColor: org?.primary_color ?? null,
      contactEmail: org?.contact_email ?? null,
      contactPhone: org?.contact_phone ?? null,
    },
  });

  return {
    organizationId: booking.organization_id as string,
    to: guest.email,
    replyTo: org?.contact_email ?? undefined,
    subject,
    html,
    text,
    guestPhone: guest.phone ?? null,
    guestFirstName: (guest.full_name ?? "").split(" ")[0] ?? "",
    unitTitle,
    checkIn: booking.check_in_date as string,
    checkOut: booking.check_out_date as string,
    totalLabel: `${currency} ${total.toLocaleString("es-AR")}`,
    deposit,
  };
}

/**
 * Punto único de envío de la confirmación de reserva al huésped (email premium
 * + WhatsApp best-effort). La seña sale de `booking.deposit_amount`: null/0 →
 * "seña a coordinar" (reservas instantáneas); >0 → muestra Seña + Restante
 * (solicitudes que el staff aprobó cargando la seña).
 */
export async function sendBookingConfirmation(params: {
  bookingId: string;
}): Promise<void> {
  const built = await buildConfirmationEmail(params);
  if (!built) return;

  await sendGuestMail({
    organizationId: built.organizationId,
    to: built.to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    replyTo: built.replyTo,
  });

  if (built.guestPhone) {
    const senaNote =
      built.deposit !== null && built.deposit > 0
        ? " La seña queda registrada y el resto se abona al ingresar."
        : "";
    await sendWhatsAppIfPossible({
      organizationId: built.organizationId,
      phone: built.guestPhone,
      message: `¡Hola ${built.guestFirstName}! Tu reserva en ${built.unitTitle} quedó confirmada del ${built.checkIn} al ${built.checkOut}. Total: ${built.totalLabel}.${senaNote} Detalles: ${APP_URL}/mi-cuenta/reservas/${params.bookingId}`,
    });
  }
}

/** Confirmación al huésped por reserva instantánea (sin staff → seña a coordinar). */
export async function notifyGuestBookingConfirmed(params: {
  bookingId: string;
}): Promise<void> {
  await sendBookingConfirmation({ bookingId: params.bookingId });
}

/**
 * Confirmación al huésped tras aprobar una solicitud. La seña ya quedó guardada
 * en `booking.deposit_amount` durante la aprobación; el email la lee de ahí.
 */
export async function notifyGuestRequestApproved(params: {
  bookingId: string;
}): Promise<void> {
  await sendBookingConfirmation({ bookingId: params.bookingId });
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

— Equipo ApartCBA`;

  await sendGuestMail({
    organizationId: req.organization_id,
    to: params.guestEmail,
    subject,
    html: plainTextToHtml(escapeHtml(body)),
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
