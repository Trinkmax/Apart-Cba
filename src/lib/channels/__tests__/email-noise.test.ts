import { describe, expect, it } from "vitest";
import { classifyIgnorableEmail, looksLikeReservationEmail } from "@/lib/channels/email-noise";

const AIRBNB = "Airbnb <automated@airbnb.com>";
const BOOKING = "Booking.com <noreply@booking.com>";

describe("classifyIgnorableEmail — ruido real de producción", () => {
  // Viaggiato, 12/11/2026: el primer día con el reenvío de Gmail andando
  // abrió estas incidencias, ninguna accionable.
  it.each([
    ["RE: Reserva de «Dpto. c/ parking gratis cerca del Hospital Córdoba», 12–13 nov", "mensaje"],
    ["RE: Reserva de «Cerca de todo Plaza España, Museos y Parque », 13–15 nov", "mensaje"],
    ["RE: Oferta especial para «Dpto. en pleno Centro con pileta y terraza», 13–15 nov", "mensaje"],
    ["Recordatorio de reserva: ¡Rodrigo está a punto de llegar!", "recordatorio"],
  ])("Airbnb: %s → %s", (subject, reason) => {
    expect(classifyIgnorableEmail(AIRBNB, subject)).toBe(reason);
  });

  it("Booking: un newsletter del producto no es una incidencia", () => {
    expect(
      classifyIgnorableEmail(
        "Booking.com <noreply@properties.booking.com>",
        "Lo nuevo de Pagos mediante Booking.com: Ahorrá tiempo con una vista centralizada de tu configuración de pagos",
      ),
    ).toBe("novedades");
  });

  // Apart CBA: incidencias abiertas que se acumulaban por los mismos motivos.
  it.each([
    ["Mensaje nuevo del Servicio al cliente de Airbnb", "mensaje"],
    ["Miguel cree que serías un excelente coanfitrión", "coanfitrion"],
    ["Gracias por aceptar la invitación de Miguel", "coanfitrion"],
    ["Te enviamos un cobro de EUR 12.50 €", "facturacion"],
    ["Le solicitaste dinero a Miguel", "facturacion"],
  ])("Airbnb: %s → %s", (subject, reason) => {
    expect(classifyIgnorableEmail(AIRBNB, subject)).toBe(reason);
  });

  it.each([
    ["We received this message from juan henao", "mensaje"],
    ["Hemos recibido este mensaje de Rosso Cudugnello Rocio", "mensaje"],
    [
      "La aprobación automática se aplicará a las solicitudes de check-in que se ajusten al horario de tus condiciones",
      "novedades",
    ],
    ["Pago en curso: comprueba el estado en la extranet", "facturacion"],
  ])("Booking: %s → %s", (subject, reason) => {
    expect(classifyIgnorableEmail(BOOKING, subject)).toBe(reason);
  });

  it("los avisos de Google reenviados son ruido", () => {
    expect(classifyIgnorableEmail("Google <no-reply@google.com>", "Alerta de seguridad")).toBe(
      "google",
    );
  });
});

describe("classifyIgnorableEmail — sin motivo de archivo para las reservas", () => {
  // Es sólo la etiqueta de auditoría; la puerta es looksLikeReservationEmail.
  // Una reserva o cancelación no tiene motivo de ruido.
  it.each([
    "Reserva confirmada: Sebastian Cruz llega el 13 nov.",
    "¡Nueva reserva! (6543210987, jueves, 13 de noviembre de 2026)",
    "Reserva cancelada: HMXSE3E8ES",
    "Cancelación de reserva 6543210987",
    // Reenvío manual: es la confirmación misma, mandada a mano.
    "Fwd: Reserva confirmada: Kevin Randle Adkins llega el 12 nov.",
    // "RV:" es el reenvío de Outlook en español, no una respuesta.
    "RV: Reserva confirmada: Adrian Cometto llega el 12 nov.",
  ])("%s → sin etiqueta de ruido", (subject) => {
    expect(classifyIgnorableEmail(AIRBNB, subject)).toBeNull();
  });
});

describe("looksLikeReservationEmail — la única puerta a una incidencia", () => {
  // Lo que los parsers saben leer: si falla uno de éstos, puede faltar algo.
  it.each([
    "Reserva confirmada: Sebastian Cruz llega el 13 nov.",
    "Reservación confirmada: María llega el 27 jul.",
    "Reservation confirmed - María González arrives May 15",
    "Solicitud de reservación confirmada: María González llega el 15 de agosto",
    "Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)",
    "New booking! Reservation 4123456789",
    "¡Reserva cancelada! (6017858947, martes, 21 de julio de 2026)",
    "Reservation cancelled",
    "Cancelación de la reservación HMXSE3E8ES",
    "Fwd: Reserva confirmada: Adrian Cometto llega el 12 nov.",
    // Apart CBA, 18/08: una cancelación de Airbnb que el parser no leyó.
    "Reservación de Airbnb cancelada",
  ])("%s → incidencia si no se pudo leer", (subject) => {
    expect(looksLikeReservationEmail(subject)).toBe(true);
  });

  // Todo lo demás se archiva en silencio: ruido real de producción.
  it.each([
    "RE: Reserva de «Cerca de todo Plaza España, Museos y Parque », 13–15 nov",
    "RE: Oferta especial para «Dpto. en pleno Centro con pileta y terraza», 13–15 nov",
    "Recordatorio de reserva: ¡Rodrigo está a punto de llegar!",
    "Recordatorio: solicitud de reservación en Depto -Diva- para las fechas 13 – 15 de nov de 2026",
    "Lo nuevo de Pagos mediante Booking.com: Ahorrá tiempo con una vista centralizada",
    "Mensaje nuevo del Servicio al cliente de Airbnb",
    "Reservación actualizada",
    "La modificación de la reservación fue aceptada",
    "A tu cliente le gustaría cancelar gratis",
    "Petición de cancelación: reserva 6228876743 - Fernandez",
    "La petición de Ricardo Morelli se ha confirmado",
    "Tu código de confirmación es 269965",
    "Política de cancelación actualizada",
    "Booking.com: Confirmá tu dirección de email",
    "Booking.com Invoice 123456",
    "Te enviamos un cobro de EUR 12.50 €",
    "Miguel cree que serías un excelente coanfitrión",
    "We received this message from juan henao",
  ])("%s → se archiva", (subject) => {
    expect(looksLikeReservationEmail(subject)).toBe(false);
  });
});
