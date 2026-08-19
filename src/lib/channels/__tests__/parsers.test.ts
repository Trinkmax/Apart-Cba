import { describe, expect, it } from "vitest";
import { airbnbParser } from "@/lib/inbound/parsers/airbnb";
import { bookingParser } from "@/lib/inbound/parsers/booking";
import { normalizeDate, parseAmount, htmlToText } from "@/lib/inbound/parse-utils";
import { normalizeInboundEmail } from "@/lib/channels/email-adapter";

const AIRBNB_CONFIRMATION = {
  from: "automated@airbnb.com",
  to: "ota-abc123@inbound.apartcba.com",
  subject: "Reservation confirmed - María González arrives May 15",
  html: "",
  text: [
    "New reservation confirmed!",
    "Guest: María González",
    "Check-in: 2026-08-15",
    "Check-out: 2026-08-18",
    "Confirmation code: HMABC12345",
    "Listing: Depto céntrico con balcón",
    "https://www.airbnb.com/rooms/50432101",
    "Total payout: $ 123,450.50",
  ].join("\n"),
};

describe("airbnbParser", () => {
  it("parsea una reserva nueva con código, fechas y listing id", () => {
    const parsed = airbnbParser.parse(AIRBNB_CONFIRMATION);
    expect(parsed).not.toBeNull();
    if (parsed?.type !== "new_booking") throw new Error("tipo inesperado");
    expect(parsed.source).toBe("airbnb");
    expect(parsed.externalId).toBe("HMABC12345");
    expect(parsed.checkIn).toBe("2026-08-15");
    expect(parsed.checkOut).toBe("2026-08-18");
    expect(parsed.guestName).toContain("María González");
    expect(parsed.externalListingId).toBe("50432101");
  });

  it("parsea una cancelación con el código exacto", () => {
    const parsed = airbnbParser.parse({
      ...AIRBNB_CONFIRMATION,
      subject: "Reservation cancelled",
      text: "Your reservation HMABC12345 was cancelled. Confirmation code: HMABC12345",
    });
    expect(parsed).toEqual({
      type: "cancellation",
      source: "airbnb",
      externalId: "HMABC12345",
    });
  });

  it("devuelve null si faltan fechas (no adivina)", () => {
    const parsed = airbnbParser.parse({
      ...AIRBNB_CONFIRMATION,
      text: "Confirmation code: HMABC12345 — sin fechas",
    });
    expect(parsed).toBeNull();
  });
});

describe("bookingParser", () => {
  it("parsea una reserva nueva con número, contacto y slug", () => {
    const parsed = bookingParser.parse({
      from: "noreply@booking.com",
      to: "ota-abc123@inbound.apartcba.com",
      subject: "New booking! Reservation 4123456789",
      html: "",
      text: [
        "Booking number: 4123456789",
        "Guest name: Juan Pérez",
        "E-mail: JUAN.PEREZ@example.com",
        "Phone: +54 9 351 555-1234",
        "Check-in: 2026-09-01",
        "Check-out: 2026-09-05",
        "Property: Mi Departamento Nueva Córdoba",
        "https://www.booking.com/hotel/ar/mi-departamento.es.html",
        "Total price: ARS 250.000,00",
      ].join("\n"),
    });
    expect(parsed).not.toBeNull();
    if (parsed?.type !== "new_booking") throw new Error("tipo inesperado");
    expect(parsed.externalId).toBe("4123456789");
    expect(parsed.guestEmail).toBe("juan.perez@example.com");
    expect(parsed.externalListingId).toBe("mi-departamento");
    expect(parsed.checkIn).toBe("2026-09-01");
  });

  // Subjects reales del extranet (producción, ago/2026). El aviso "¡Nueva
  // reserva!" no trae el detalle de la estadía, pero número y llegada viajan
  // juntos en el subject — el único cruce posible con el iCal, que sólo tiene
  // uid y fechas.
  it("el aviso '¡Nueva reserva!' sin cuerpo cae en un evento de referencia", () => {
    const parsed = bookingParser.parse({
      from: "noreply@booking.com",
      to: "ota-abc123@inbound.apartcba.com",
      subject: "Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)",
      html: "",
      text: "Tenés una reserva nueva. Entrá al extranet para ver el detalle.",
    });
    expect(parsed).not.toBeNull();
    if (parsed?.type !== "reference") throw new Error("tipo inesperado");
    expect(parsed.externalId).toBe("5718506503");
    expect(parsed.checkIn).toBe("2026-12-04");
  });

  it("la cancelación extrae también la fecha de llegada del subject", () => {
    const parsed = bookingParser.parse({
      from: "noreply@booking.com",
      to: "ota-abc123@inbound.apartcba.com",
      subject: "¡Reserva cancelada! (6017858947, martes, 21 de julio de 2026)",
      html: "",
      text: "El huésped canceló su reserva.",
    });
    expect(parsed).not.toBeNull();
    if (parsed?.type !== "cancellation") throw new Error("tipo inesperado");
    expect(parsed.externalId).toBe("6017858947");
    expect(parsed.checkIn).toBe("2026-07-21");
  });

  it("un email con la estadía completa sigue siendo reserva, no referencia", () => {
    const parsed = bookingParser.parse({
      from: "noreply@booking.com",
      to: "ota-abc123@inbound.apartcba.com",
      subject: "Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)",
      html: "",
      text: ["Llegada: 4 de diciembre de 2026", "Salida: 7 de diciembre de 2026"].join("\n"),
    });
    if (parsed?.type !== "new_booking") throw new Error("tipo inesperado");
    expect(parsed.checkIn).toBe("2026-12-04");
    expect(parsed.checkOut).toBe("2026-12-07");
  });

  it("el día de la semana del subject no se confunde con la fecha", () => {
    const parsed = bookingParser.parse({
      from: "noreply@booking.com",
      to: "ota-abc123@inbound.apartcba.com",
      subject: "Booking.com - ¡Nueva reserva! (5908886743, sábado, 29 de agosto de 2026)",
      html: "",
      text: "sin detalle",
    });
    if (parsed?.type !== "reference") throw new Error("tipo inesperado");
    expect(parsed.checkIn).toBe("2026-08-29");
  });
});

describe("normalizeInboundEmail (adaptador email → ReservationEvent)", () => {
  it("produce el evento canónico con dedupe por provider message id", () => {
    const n = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-123",
      email: AIRBNB_CONFIRMATION,
    });
    expect(n.parserUsed).toBe("airbnb");
    expect(n.event?.dedupeKey).toBe("email:msg-123");
    expect(n.event?.eventType).toBe("reservation_upsert");
    expect(n.event?.confirmationCode).toBe("HMABC12345");
    expect(n.contentHash).toHaveLength(64);
  });

  it("un reintento del mismo email produce exactamente la misma clave (idempotente)", () => {
    const a = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-123",
      email: AIRBNB_CONFIRMATION,
    });
    const b = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-123",
      email: AIRBNB_CONFIRMATION,
    });
    expect(a.event?.dedupeKey).toBe(b.event?.dedupeKey);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("el aviso de Booking produce un evento reservation_reference", () => {
    const n = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-777",
      email: {
        from: "noreply@booking.com",
        to: "ota-abc123@inbound.apartcba.com",
        subject: "Booking.com - ¡Nueva reserva! (6963230667, lunes, 9 de noviembre de 2026)",
        html: "",
        text: "sin detalle de la estadía",
      },
    });
    expect(n.parserUsed).toBe("booking");
    expect(n.event?.eventType).toBe("reservation_reference");
    expect(n.event?.confirmationCode).toBe("6963230667");
    expect(n.event?.checkIn).toBe("2026-11-09");
  });

  it("email irreconocible → sin evento, con hash para auditoría", () => {
    const n = normalizeInboundEmail({
      organizationId: "org-1",
      providerMessageId: "msg-999",
      email: { from: "spam@x.com", to: "", subject: "Hola", html: "", text: "nada" },
    });
    expect(n.event).toBeNull();
    expect(n.contentHash).toHaveLength(64);
  });
});

describe("parse-utils", () => {
  it("normaliza fechas en español e inglés", () => {
    expect(normalizeDate("15 de mayo de 2026")).toBe("2026-05-15");
    expect(normalizeDate("May 15, 2026")).toBe("2026-05-15");
    expect(normalizeDate("2026-05-15")).toBe("2026-05-15");
    expect(normalizeDate("no es fecha")).toBeNull();
  });
  it("parsea montos es-AR y en", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });
  it("convierte html a texto sin tags", () => {
    expect(htmlToText("<p>Hola<br/>mundo</p>")).toBe("Hola\nmundo");
  });
});
