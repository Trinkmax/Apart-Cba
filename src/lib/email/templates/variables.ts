/**
 * Lista cerrada de variables {{path.to.var}} permitidas en templates de cada
 * event_type. Validamos contra esto antes de guardar para evitar typos.
 */

const BOOKING_MESSAGE_VARS = [
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
  "unit.maps_url",
  "unit.instructions",
  "booking.check_in_date",
  "booking.check_in_date_iso",
  "booking.check_in_time",
  "booking.check_out_date",
  "booking.check_out_date_iso",
  "booking.check_out_time",
  "booking.nights",
  "booking.guests_count",
  "booking.guests",
  "booking.total_amount",
  "booking.total_amount_raw",
  "booking.currency",
  "booking.balance_due",
  "booking.deposit_amount",
  "booking.deposit_amount_raw",
  "booking.remaining_after_deposit",
  "booking.security_deposit",
  "booking.security_deposit_raw",
  "booking.mode",
  "booking.payment_link",
] as const;

export const ALLOWED_TEMPLATE_VARS: Record<string, readonly string[]> = {
  booking_confirmed: BOOKING_MESSAGE_VARS,
  booking_instructions: BOOKING_MESSAGE_VARS,
};

/**
 * Las variables que ofrece el editor, agrupadas y con nombre en castellano.
 * Las técnicas (`_iso`, `_raw`, `mode`, `payment_link`) siguen siendo válidas
 * —hay plantillas viejas que las usan— pero no se ofrecen.
 */
export const TEMPLATE_VAR_GROUPS: readonly {
  title: string;
  vars: readonly { key: string; label: string }[];
}[] = [
  {
    title: "Huésped",
    vars: [
      { key: "guest.first_name", label: "Nombre" },
      { key: "guest.full_name", label: "Nombre y apellido" },
      { key: "guest.phone", label: "Teléfono" },
      { key: "guest.email", label: "Email" },
    ],
  },
  {
    title: "Reserva",
    vars: [
      { key: "booking.check_in_date", label: "Fecha de ingreso" },
      { key: "booking.check_in_time", label: "Hora de ingreso" },
      { key: "booking.check_out_date", label: "Fecha de salida" },
      { key: "booking.check_out_time", label: "Hora de salida" },
      { key: "booking.nights", label: "Noches" },
      { key: "booking.guests", label: "Huéspedes (ej.: 2 personas)" },
      { key: "booking.total_amount", label: "Monto total" },
      { key: "booking.balance_due", label: "Saldo (total − cobrado)" },
      { key: "booking.deposit_amount", label: "Seña" },
      { key: "booking.remaining_after_deposit", label: "Restante (total − seña)" },
      { key: "booking.security_deposit", label: "Depósito en garantía" },
    ],
  },
  {
    title: "Depto",
    vars: [
      { key: "unit.name", label: "Nombre del depto" },
      { key: "unit.address", label: "Dirección" },
      { key: "unit.maps_url", label: "Link de Google Maps" },
      { key: "unit.instructions", label: "Instructivo del depto" },
    ],
  },
  {
    title: "Tu empresa",
    vars: [
      { key: "org.name", label: "Nombre" },
      { key: "org.contact_phone", label: "Teléfono" },
      { key: "org.contact_email", label: "Email" },
    ],
  },
];

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
