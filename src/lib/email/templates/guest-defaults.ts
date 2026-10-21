/**
 * Los dos mensajes al huésped que se copian desde la ficha de la reserva, con
 * su texto de arranque. Viven en `org_message_templates` (canal `whatsapp`);
 * una org sin fila, o con la fila en `is_default`, usa lo de acá:
 *
 * - `booking_confirmed`: sin editar, la reserva muestra el mensaje original
 *   calculado en código (`renderBookingConfirmationText`, con seña por
 *   defecto y depósito sólo si hay). El texto de acá es sólo el punto de
 *   partida del editor, parecido a ese mensaje.
 * - `booking_instructions`: sin editar no aparece en la reserva. Se activa la
 *   primera vez que la org lo guarda.
 */

export const GUEST_MESSAGE_EVENTS = ["booking_confirmed", "booking_instructions"] as const;
export type GuestMessageEvent = (typeof GUEST_MESSAGE_EVENTS)[number];

export function isGuestMessageEvent(v: string): v is GuestMessageEvent {
  return (GUEST_MESSAGE_EVENTS as readonly string[]).includes(v);
}

export const GUEST_MESSAGE_META: Record<
  GuestMessageEvent,
  { title: string; description: string }
> = {
  booking_confirmed: {
    title: "Confirmación de reserva",
    description:
      "Es el mensaje que aparece abajo de cada reserva para copiar y pegar en WhatsApp. También es el que sale por mail cuando confirmás una reserva.",
  },
  booking_instructions: {
    title: "Instructivo para el huésped",
    description:
      "Un segundo mensaje para copiar desde la reserva: cómo llegar, los datos del depto y el reglamento. Aparece en las reservas cuando lo guardás.",
  },
};

export const DEFAULT_GUEST_MESSAGES: Record<GuestMessageEvent, string> = {
  booking_confirmed: [
    "¡Nos pone muy contentos de tenerte como huésped!",
    "",
    "🏡 Tu reserva es del {{booking.check_in_date}} al {{booking.check_out_date}} en el departamento {{unit.name}}, para {{booking.guests}}.",
    "A nombre de: {{guest.full_name}}",
    "",
    "💰 Monto total: {{booking.total_amount}}",
    "Seña: {{booking.deposit_amount}}",
    "Restante: {{booking.remaining_after_deposit}}",
    "",
    "El restante se abona el día que entregamos las llaves, en efectivo o por transferencia.",
    "",
    "📅 Uno o dos días antes de tu ingreso te vamos a contactar para coordinar los últimos detalles: horario de check-in, entrega de llaves, etc.",
    "Si ves algún error en este mensaje, avisanos.",
    "",
    "👋 ¡Gracias y nos vemos pronto!",
  ].join("\n"),
  booking_instructions: [
    "¡Hola {{guest.first_name}}! 👋 Te paso todo lo que necesitás para tu llegada a {{unit.name}}.",
    "",
    "📅 Ingreso: {{booking.check_in_date}} desde las {{booking.check_in_time}}",
    "📅 Salida: {{booking.check_out_date}} hasta las {{booking.check_out_time}}",
    "",
    "📍 Dirección: {{unit.address}}",
    "🗺️ Cómo llegar: {{unit.maps_url}}",
    "",
    "{{unit.instructions}}",
    "",
    "📋 Reglamento",
    "• (Escribí acá las normas de la casa)",
    "",
    "¡Que disfrutes la estadía!",
  ].join("\n"),
};
