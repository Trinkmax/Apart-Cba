import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { renderTemplate } from "./render";
import { formatMoney } from "@/lib/format";

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
