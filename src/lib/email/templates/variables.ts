/**
 * Lista cerrada de variables {{path.to.var}} permitidas en templates de cada
 * event_type. Validamos contra esto antes de guardar para evitar typos.
 */

export const ALLOWED_TEMPLATE_VARS: Record<string, readonly string[]> = {
  booking_confirmed: [
    "guest.full_name",
    "guest.first_name",
    "guest.email",
    "guest.phone",
    "org.name",
    "org.contact_phone",
    "org.contact_email",
    "org.address",
    "unit.name",
    "unit.code",
    "unit.address",
    "booking.check_in_date",
    "booking.check_in_date_iso",
    "booking.check_out_date",
    "booking.check_out_date_iso",
    "booking.nights",
    "booking.guests_count",
    "booking.total_amount",
    "booking.total_amount_raw",
    "booking.currency",
    "booking.balance_due",
    "booking.payment_link",
  ],
};

export function extractVariablesFromBody(body: string): string[] {
  const matches = body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

export function findInvalidVariables(body: string, eventType: string): string[] {
  const allowed = ALLOWED_TEMPLATE_VARS[eventType];
  if (!allowed) return [];
  const used = extractVariablesFromBody(body);
  return used.filter((v) => !allowed.includes(v));
}
