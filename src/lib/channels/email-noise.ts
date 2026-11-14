/**
 * Triage de los mails de OTA que los parsers no pudieron leer.
 *
 * La regla es una lista BLANCA, no negra: un mail que no se pudo leer sólo abre
 * una incidencia si su asunto anuncia una reserva (nueva o confirmada) o una
 * cancelación, que es justo lo que los parsers saben leer. Si uno de ésos
 * falla, puede faltar algo. Todo lo demás se archiva en silencio, con un motivo
 * para auditoría.
 *
 * Antes era al revés: todo lo que no estaba en una lista de ruido abría una
 * incidencia, y esa lista nunca alcanzaba. Cada plantilla nueva de Airbnb o
 * Booking (mensajes de huéspedes, recordatorios, newsletters, avisos de
 * producto, cobros, coanfitriones) era una alerta más. Apart CBA juntó 108
 * abiertas en un mes y Viaggiato 12 en su primer día con el reenvío de Gmail;
 * lo que la clienta leyó fue "el sistema todo el tiempo me tira errores".
 *
 * Archivar uno de más no rompe nada: la ocupación la trae el iCal. El mail sólo
 * aporta huésped, importe y número de reserva.
 */

/** ¿El asunto anuncia una reserva nueva/confirmada o una cancelación? */
export function looksLikeReservationEmail(subject: string): boolean {
  const s = subject.trim();
  // Una respuesta dentro de una conversación ("RE: Reserva de «Anuncio», 12–13
  // nov") nombra la reserva pero es un mensaje del huésped.
  if (/^re\s*:/i.test(s)) return false;
  // Solicitudes, peticiones y recordatorios (mismo criterio que el parser de
  // Airbnb): no son reservas ni cancelaciones, salvo que digan que quedaron
  // confirmadas. "Petición de cancelación: reserva 6228876743" es un pedido del
  // huésped que se contesta en Booking, igual que "le gustaría cancelar gratis".
  if (/solicitud|petici[oó]n|recordatorio|reminder|request/i.test(s) && !/confirm/i.test(s)) {
    return false;
  }
  return CONFIRMATION.test(s) || CANCELLATION.test(s);
}

// "Reserva confirmada: X llega…", "Reservación confirmada", "Reservation
// confirmed", "¡Nueva reserva! (número, fecha)", "New booking!". "Booking.com"
// no cuenta como la palabra reserva: "Booking.com: Confirmá tu email" no lo es.
const CONFIRMATION =
  /\b(?:reserva|reservaci[oó]n|reservation|booking(?!\.com))\b[^\n]{0,15}\bconfirm|nueva reserva|reserva nueva|new booking|new reservation/i;

// "¡Reserva cancelada!", "Reservation cancelled", "Cancelación de la
// reservación HM…", "Canceled: Reservation HM…". Exige la palabra reserva cerca:
// "Política de cancelación actualizada" no es una cancelación, y "A tu cliente
// le gustaría cancelar gratis" (cancelar ≠ cancelada) es un pedido que se
// contesta en Booking.
const CANCELLATION =
  /\b(?:reserva|reservaci[oó]n|reservation|booking(?!\.com))\b[^\n]{0,30}cancel(?!ar)|cancel(?!ar)[^\n]{0,30}\b(?:reserva|reservaci[oó]n|reservation|booking(?!\.com))\b/i;

/**
 * Motivo con el que se archiva un mail que no se pudo leer (queda en el evento
 * para auditoría). No decide nada: la puerta es `looksLikeReservationEmail`.
 */
export function classifyIgnorableEmail(from: string, subject: string): string | null {
  // Avisos de Google que llegan reenviados. La confirmación de reenvío de Gmail
  // no pasa por acá: no es ruido, es un paso pendiente (gmail-forwarding.ts).
  if (/@google\.com$|@google\.com>/i.test(from.trim())) {
    return "google";
  }
  const s = subject.trim();

  if (/^re\s*:/i.test(s)) return "mensaje";
  if (/rese[ñn]a|review/i.test(s)) return "resena";
  if (/sign.?in|inicio de sesi[oó]n|new device|nuevo dispositivo/i.test(s)) return "seguridad";
  if (/c[oó]digo de verificaci[oó]n|verification code|c[oó]digo de acceso/i.test(s)) return "seguridad";
  if (/consulta sobre/i.test(s)) return "consulta";
  if (/recordatorio.*solicitud|solicitud de reservaci[oó]n|reservation request/i.test(s)) {
    return "solicitud_pendiente";
  }
  if (/recordatorio de reserva|est[áa] a punto de llegar|reservation reminder/i.test(s)) {
    return "recordatorio";
  }
  if (/pregunta sobre tu alojamiento|nueva pregunta|new question/i.test(s)) return "pregunta";
  if (
    /pagos pendientes|saldes los pagos|factura|invoice|comisi[oó]n|payout|extracto|pago en curso|te enviamos un cobro|solicitaste dinero/i.test(
      s,
    )
  ) {
    return "facturacion";
  }
  if (
    /te envi[oó] un mensaje|nuevo mensaje|mensaje nuevo|new message|hemos recibido este mensaje|we received this message/i.test(
      s,
    )
  ) {
    return "mensaje";
  }
  if (/coanfitri[oó]n|co-?host|aceptar la invitaci[oó]n/i.test(s)) return "coanfitrion";
  if (/modific|actualizad|altered|changed/i.test(s)) return "modificacion";
  if (/^lo nuevo de|aprobaci[oó]n autom[aá]tica/i.test(s)) return "novedades";
  if (/est[áa]n esperando tu|completa tu|aumenta tus reservas|consejos para/i.test(s)) {
    return "marketing";
  }
  return null;
}
