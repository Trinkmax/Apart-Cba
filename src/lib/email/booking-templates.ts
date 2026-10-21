import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  effectiveSena,
  renderBookingConfirmationText,
} from "./booking-confirmation";
import {
  bookingMessageVariables,
  nightsBetweenIso,
  renderGuestMessage,
  type BookingMessageSource,
  type BookingMessageVariables,
} from "./booking-message";
import {
  DEFAULT_GUEST_MESSAGES,
  GUEST_MESSAGE_EVENTS,
  type GuestMessageEvent,
} from "./templates/guest-defaults";

export interface BookingTemplateContext {
  variables: BookingMessageVariables;
  organizationId: string;
  guestEmail: string | null;
  orgContactEmail: string | null;
}

// Todo lo que necesitan los mensajes al huésped, en un solo select.
const MESSAGE_BOOKING_SELECT = `
  id,
  organization_id,
  check_in_date,
  check_out_date,
  check_in_time,
  check_out_time,
  total_amount,
  currency,
  paid_amount,
  deposit_amount,
  security_deposit,
  mode,
  guests_count,
  guest:guests(full_name, email, phone),
  unit:units(name, code, address, marketplace_title, guest_maps_url, guest_instructions),
  organization:organizations(name, contact_phone, contact_email, address)
`;

type MessageBookingRow = BookingMessageSource["booking"] & {
  id: string;
  organization_id: string;
  guest: BookingMessageSource["guest"];
  unit: BookingMessageSource["unit"];
  organization: BookingMessageSource["org"];
};

async function loadMessageBooking(
  bookingId: string,
  organizationId: string
): Promise<MessageBookingRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select(MESSAGE_BOOKING_SELECT)
    .eq("id", bookingId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as unknown as MessageBookingRow | null) ?? null;
}

function sourceOf(b: MessageBookingRow): BookingMessageSource {
  return { booking: b, guest: b.guest, unit: b.unit, org: b.organization };
}

/**
 * Carga la reserva (sólo de esa org) y arma las variables de los mensajes.
 * Devuelve también el email del huésped (para el to:) y el de contacto de la
 * org (para el reply-to). null si la reserva no existe o es de otra org.
 */
export async function buildBookingContext(
  bookingId: string,
  organizationId: string
): Promise<BookingTemplateContext | null> {
  const b = await loadMessageBooking(bookingId, organizationId);
  if (!b) return null;
  return {
    variables: bookingMessageVariables(sourceOf(b)),
    organizationId: b.organization_id,
    guestEmail: b.guest?.email ?? null,
    orgContactEmail: b.organization?.contact_email ?? null,
  };
}

export interface GuestMessageTemplate {
  body: string;
  /** false = la org nunca lo editó (o volvió al original): se usa lo de fábrica. */
  custom: boolean;
}

/**
 * Las plantillas de los mensajes al huésped de la org (Configuración →
 * Comunicaciones). Sin fila, o con la fila en `is_default`, vale el texto de
 * arranque del código: ver guest-defaults.ts para qué significa en cada una.
 */
export async function getGuestMessageTemplates(
  organizationId: string
): Promise<Record<GuestMessageEvent, GuestMessageTemplate>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("org_message_templates")
    .select("event_type, body, is_default")
    .eq("organization_id", organizationId)
    .eq("channel", "whatsapp")
    .in("event_type", GUEST_MESSAGE_EVENTS);
  const out = {} as Record<GuestMessageEvent, GuestMessageTemplate>;
  for (const event of GUEST_MESSAGE_EVENTS) {
    const row = (data ?? []).find((r) => r.event_type === event);
    out[event] =
      row && !row.is_default
        ? { body: row.body as string, custom: true }
        : { body: DEFAULT_GUEST_MESSAGES[event], custom: false };
  }
  return out;
}

/**
 * Borrador del mail de confirmación: el mismo mensaje que se copia desde la
 * reserva para WhatsApp. Si la org editó su "Confirmación de reserva", es esa
 * plantilla; si no, el copy del dueño (`renderBookingConfirmationText`), que
 * reproduce la lógica condicional (seña por defecto = 1 noche, depósito sólo
 * si hay) que un `{{var}}` estático no puede. Lo usan el modal de
 * "Confirmar/Reenviar confirmación" (pre-carga editable) y el envío sin
 * override. null si la reserva no existe o es de otra org.
 */
export async function buildOwnerConfirmationDraft(
  bookingId: string,
  organizationId: string
): Promise<{ subject: string; body: string } | null> {
  const [b, templates] = await Promise.all([
    loadMessageBooking(bookingId, organizationId),
    getGuestMessageTemplates(organizationId),
  ]);
  if (!b) return null;

  const unitTitle =
    b.unit?.marketplace_title?.trim() || b.unit?.name?.trim() || "tu departamento";
  const subject = `¡Tu reserva está confirmada! — ${unitTitle}`;

  const tpl = templates.booking_confirmed;
  if (tpl.custom) {
    return { subject, body: renderGuestMessage(tpl.body, bookingMessageVariables(sourceOf(b))) };
  }

  const ci = b.check_in_date;
  const co = b.check_out_date;
  const total = Number(b.total_amount ?? 0);
  const oneNight = Math.round(total / nightsBetweenIso(ci, co));
  // Seña: explícita (deposit_amount) → cobrada (paid_amount) → 1 noche. Ver effectiveSena.
  const deposit = effectiveSena(
    b.deposit_amount != null ? Number(b.deposit_amount) : null,
    b.paid_amount != null ? Number(b.paid_amount) : null,
    oneNight
  );
  const securityDeposit =
    b.security_deposit != null ? Number(b.security_deposit) : null;

  const body = renderBookingConfirmationText({
    guestName: b.guest?.full_name ?? "",
    unitTitle,
    checkInIso: ci,
    checkOutIso: co,
    guestsCount: Number(b.guests_count ?? 1),
    currency: String(b.currency ?? "ARS"),
    total,
    deposit,
    securityDeposit,
  });
  return { subject, body };
}
