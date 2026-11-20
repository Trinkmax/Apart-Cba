import { describe, expect, it } from "vitest";
import { isAbsorbedByOurCalendar, type AbsorbedClosureFacts } from "../absorbed-closure";

// Cofico Ideal, 15/11/2026: aparece 04:56:08, Booking lee nuestro calendario
// 06:39:40 y la entrada falta desde la lectura de las 06:44:07.
const cofico: AbsorbedClosureFacts = {
  channel: "booking",
  bookingCreatedAt: "2026-11-15T04:56:08Z",
  bookingLoadedByPerson: false,
  hasReservationNumber: false,
  firstReadAt: "2026-11-15T06:39:40Z",
  missingSince: "2026-11-15T06:44:07Z",
};

describe("isAbsorbedByOurCalendar", () => {
  it("deja de publicarse minutos después de que Booking lee nuestro calendario", () => {
    expect(isAbsorbedByOurCalendar(cofico)).toBe(true);
    // los otros cuatro casos medidos
    for (const [created, read, missing] of [
      ["2026-11-13T15:40:05Z", "2026-11-13T16:55:42Z", "2026-11-13T16:58:04Z"],
      ["2026-11-13T18:22:05Z", "2026-11-13T19:05:34Z", "2026-11-13T19:10:05Z"],
      ["2026-11-14T20:38:08Z", "2026-11-14T22:04:44Z", "2026-11-14T22:08:07Z"],
      ["2026-11-15T11:56:05Z", "2026-11-15T13:07:36Z", "2026-11-15T13:08:06Z"],
    ]) {
      expect(
        isAbsorbedByOurCalendar({ ...cofico, bookingCreatedAt: created, firstReadAt: read, missingSince: missing }),
      ).toBe(true);
    }
  });

  // Una reserva de verdad sigue publicada después de esa lectura: si falta
  // horas más tarde, es otra cosa y se pregunta como siempre.
  it("si falta horas después de la lectura, no se lo atribuye", () => {
    expect(isAbsorbedByOurCalendar({ ...cofico, missingSince: "2026-11-15T09:30:00Z" })).toBe(false);
    expect(isAbsorbedByOurCalendar({ ...cofico, missingSince: "2026-11-18T10:00:00Z" })).toBe(false);
  });

  it("si faltaba ANTES de que Booking leyera, la lectura no lo explica", () => {
    expect(isAbsorbedByOurCalendar({ ...cofico, missingSince: "2026-11-15T06:38:05Z" })).toBe(false);
  });

  it("sin una lectura anotada no concluye nada", () => {
    expect(isAbsorbedByOurCalendar({ ...cofico, firstReadAt: null })).toBe(false);
    expect(isAbsorbedByOurCalendar({ ...cofico, missingSince: null })).toBe(false);
    expect(isAbsorbedByOurCalendar({ ...cofico, bookingCreatedAt: undefined })).toBe(false);
  });

  // El registro de lecturas empezó el 19/11: para una reserva de antes, la
  // «primera lectura anotada» no es la primera de verdad.
  it("una primera lectura anotada días después de la reserva no prueba nada", () => {
    expect(
      isAbsorbedByOurCalendar({
        ...cofico,
        bookingCreatedAt: "2026-11-10T12:00:00Z",
        firstReadAt: "2026-11-19T16:30:00Z",
        missingSince: "2026-11-19T16:34:00Z",
      }),
    ).toBe(false);
  });

  it("sólo Booking, y sólo reservas que salieron de leer su calendario", () => {
    expect(isAbsorbedByOurCalendar({ ...cofico, channel: "airbnb" })).toBe(false);
    expect(isAbsorbedByOurCalendar({ ...cofico, bookingLoadedByPerson: true })).toBe(false);
  });

  // Llegó el aviso «¡Nueva reserva!» con su número: es una reserva de Booking.
  // Si justo se cancela después de una lectura, hay que preguntar.
  it("una reserva con número nunca se toma por un cierre", () => {
    expect(isAbsorbedByOurCalendar({ ...cofico, hasReservationNumber: true })).toBe(false);
  });
});
