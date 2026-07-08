import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { renderTemplate } from "./render";
import { formatMoney } from "@/lib/format";
import {
  effectiveSena,
  renderBookingConfirmationText,
} from "./booking-confirmation";

// APP_URL para el link del depto (mismo saneo que en marketplace/notifications.ts:
// el env de Vercel puede traer un "\n" al final y parte el link).
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001")
  .trim()
  .replace(/\/+$/, "");

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function formatDateEs(iso: string): string {
  const d = new Date(iso + (iso.includes("T") ? "" : "T12:00:00"));
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export interface BookingTemplateContext {
  variables: Record<string, unknown>;
  organizationId: string;
  guestEmail: string | null;
  orgContactEmail: string | null;
}

/**
 * Carga el booking + relaciones desde DB y arma el bag de variables para
 * renderTemplate. Devuelve también email del huésped (para el to:) y email
 * de contacto de la org (para reply-to). null si el booking no existe.
 */
export async function buildBookingContext(
  bookingId: string
): Promise<BookingTemplateContext | null> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select(
      `
      id,
      organization_id,
      check_in_date,
      check_out_date,
      total_amount,
      currency,
      paid_amount,
      deposit_amount,
      security_deposit,
      mode,
      guests_count,
      guest:guests(full_name, email, phone),
      unit:units(name, code, address),
      organization:organizations(name, contact_phone, contact_email, address)
    `
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  const guest = booking.guest as unknown as
    | { full_name: string; email: string | null; phone: string | null }
    | null;
  const unit = booking.unit as unknown as
    | { name: string; code: string; address: string | null }
    | null;
  const org = booking.organization as unknown as
    | {
        name: string;
        contact_phone: string | null;
        contact_email: string | null;
        address: string | null;
      }
    | null;

  const ci = booking.check_in_date as string;
  const co = booking.check_out_date as string;
  const nights = Math.round(
    (new Date(co).getTime() - new Date(ci).getTime()) / 86_400_000
  );
  const balance =
    Number(booking.total_amount ?? 0) - Number(booking.paid_amount ?? 0);
  const currency = String(booking.currency ?? "ARS");
  // Seña informada: la explícita (deposit_amount) → lo cobrado ("Cobrado" =
  // paid_amount) → el valor de una noche por defecto. Ver effectiveSena().
  const oneNight =
    nights > 0 ? Math.round(Number(booking.total_amount ?? 0) / nights) : null;
  const sena = effectiveSena(
    booking.deposit_amount != null ? Number(booking.deposit_amount) : null,
    booking.paid_amount != null ? Number(booking.paid_amount) : null,
    oneNight
  );
  const remainingAfterDeposit =
    sena != null ? Math.max(0, Number(booking.total_amount ?? 0) - sena) : null;

  const variables = {
    guest: {
      full_name: guest?.full_name ?? "",
      first_name: guest?.full_name?.split(" ")[0] ?? "",
      email: guest?.email ?? "",
      phone: guest?.phone ?? "",
    },
    org: {
      name: org?.name ?? "",
      contact_phone: org?.contact_phone ?? "",
      contact_email: org?.contact_email ?? "",
      address: org?.address ?? "",
    },
    unit: {
      name: unit?.name ?? "",
      code: unit?.code ?? "",
      address: unit?.address ?? "",
    },
    booking: {
      check_in_date: formatDateEs(ci),
      check_in_date_iso: ci,
      check_out_date: formatDateEs(co),
      check_out_date_iso: co,
      nights,
      guests_count: booking.guests_count ?? 0,
      total_amount: formatMoney(Number(booking.total_amount ?? 0), currency),
      total_amount_raw: String(booking.total_amount ?? 0),
      currency,
      balance_due: formatMoney(balance, currency),
      // Seña informada al huésped (deposit_amount → o lo cobrado) y restante = total − seña.
      deposit_amount: sena != null ? formatMoney(sena, currency) : "",
      deposit_amount_raw: sena != null ? String(sena) : "",
      remaining_after_deposit:
        remainingAfterDeposit != null
          ? formatMoney(remainingAfterDeposit, currency)
          : "",
      // Depósito en garantía (reservas mensuales), monto aparte del total.
      security_deposit:
        booking.security_deposit != null
          ? formatMoney(Number(booking.security_deposit), currency)
          : "",
      security_deposit_raw:
        booking.security_deposit != null ? String(booking.security_deposit) : "",
      mode: String(booking.mode ?? "temporario"),
      payment_link: "",
    },
  };

  return {
    variables,
    organizationId: booking.organization_id as string,
    guestEmail: guest?.email ?? null,
    orgContactEmail: org?.contact_email ?? null,
  };
}

/**
 * Carga el template de la org para (event_type, channel) y lo renderiza
 * con las variables del booking. null si no hay template.
 */
export async function getRenderedBookingTemplate(args: {
  organizationId: string;
  eventType: string;
  channel: "email" | "whatsapp";
  variables: Record<string, unknown>;
}): Promise<{ subject: string | null; body: string } | null> {
  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from("org_message_templates")
    .select("subject, body")
    .eq("organization_id", args.organizationId)
    .eq("event_type", args.eventType)
    .eq("channel", args.channel)
    .maybeSingle();
  if (!tpl) return null;
  return {
    subject: tpl.subject ? renderTemplate(tpl.subject, args.variables) : null,
    body: renderTemplate(tpl.body, args.variables),
  };
}

/**
 * Borrador de confirmación con el **copy del dueño** (idéntico al mensaje de la
 * card de WhatsApp: `renderBookingConfirmationText`). Lo usan el modal de
 * "Confirmar/Reenviar confirmación" (pre-carga editable) y el fallback de envío,
 * para que el email diga exactamente lo mismo que el mensaje de WhatsApp, con
 * seña + restante + depósito ya completados. Ventaja sobre el template editable:
 * reproduce toda la lógica condicional (seña por defecto = 1 noche, depósito
 * solo en mensuales) que un `{{var}}` estático no puede. null si no existe.
 */
export async function buildOwnerConfirmationDraft(
  bookingId: string
): Promise<{ subject: string; body: string } | null> {
  const admin = createAdminClient();
  const { data: b } = await admin
    .from("bookings")
    .select(
      `
      check_in_date, check_out_date, total_amount, currency, guests_count,
      deposit_amount, paid_amount, security_deposit,
      guest:guests(full_name),
      unit:units(name, marketplace_title, slug)
    `
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;

  const guest = b.guest as unknown as { full_name: string } | null;
  const unit = b.unit as unknown as {
    name: string;
    marketplace_title: string | null;
    slug: string | null;
  } | null;

  const ci = b.check_in_date as string;
  const co = b.check_out_date as string;
  const nights = Math.max(
    1,
    Math.round(
      (new Date(co + "T12:00:00").getTime() -
        new Date(ci + "T12:00:00").getTime()) /
        86_400_000
    )
  );
  const total = Number(b.total_amount ?? 0);
  const oneNight = Math.round(total / nights);
  // Seña: explícita (deposit_amount) → cobrada (paid_amount) → 1 noche. Ver effectiveSena.
  const deposit = effectiveSena(
    b.deposit_amount != null ? Number(b.deposit_amount) : null,
    b.paid_amount != null ? Number(b.paid_amount) : null,
    oneNight
  );
  const securityDeposit =
    b.security_deposit != null ? Number(b.security_deposit) : null;
  const unitTitle = unit?.marketplace_title || unit?.name || "tu departamento";
  const listingUrl = unit?.slug ? `${APP_URL}/u/${unit.slug}` : null;

  const body = renderBookingConfirmationText({
    guestName: guest?.full_name ?? "",
    unitTitle,
    checkInIso: ci,
    checkOutIso: co,
    guestsCount: Number(b.guests_count ?? 1),
    currency: String(b.currency ?? "ARS"),
    total,
    deposit,
    securityDeposit,
    listingUrl,
  });
  const subject = `¡Tu reserva está confirmada! — ${unitTitle}`;
  return { subject, body };
}
