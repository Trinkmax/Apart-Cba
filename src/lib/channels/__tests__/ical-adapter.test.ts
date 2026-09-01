import { describe, expect, it } from "vitest";
import { parseIcs, toReservationEvent } from "@/lib/channels/ical-adapter";

function ics(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function vevent(uid: string, start: string, end: string, summary: string, description?: string) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260701T000000Z",
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${summary}`,
    ...(description ? [`DESCRIPTION:${description}`] : []),
    "END:VEVENT",
  ].join("\r\n");
}

describe("parseIcs — Airbnb", () => {
  it("importa 'Reserved' con código de confirmación desde la DESCRIPTION", () => {
    const events = parseIcs(
      ics([
        vevent(
          "abc123@airbnb.com",
          "20260815",
          "20260818",
          "Reserved",
          "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMXYZ12345\\nPhone Number (Last 4 Digits): 5678",
        ),
      ]),
      "airbnb",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "abc123@airbnb.com",
      checkIn: "2026-08-15",
      checkOut: "2026-08-18",
      isBlock: false,
      confirmationCode: "HMXYZ12345",
      phoneLast4: "5678",
    });
  });

  it("descarta bloqueos 'Airbnb (Not available)' (ruido de ventana)", () => {
    const events = parseIcs(
      ics([vevent("blk1@airbnb.com", "20260901", "20260902", "Airbnb (Not available)")]),
      "airbnb",
    );
    expect(events).toHaveLength(0);
  });

  it("descarta nuestros propios eventos exportados (self-import guard)", () => {
    const events = parseIcs(
      ics([vevent("apartcba-xxx@apartcba.app", "20260901", "20260903", "Reserved")]),
      "airbnb",
    );
    expect(events).toHaveLength(0);
  });

  it("descarta eventos con fechas inválidas (end <= start)", () => {
    const events = parseIcs(
      ics([vevent("bad@airbnb.com", "20260903", "20260903", "Reserved")]),
      "airbnb",
    );
    expect(events).toHaveLength(0);
  });
});

describe("parseIcs — Booking.com", () => {
  // Booking manda el MISMO VEVENT para una reserva y para un cierre manual del
  // extranet ("CLOSED - Not available", sin DESCRIPTION ni ningún otro campo).
  // Como no se puede distinguir, entra como reserva: una reserva real tratada
  // como bloqueo queda invisible (sin aviso, sin limpieza, sin liquidar); un
  // cierre tratado como reserva se ve y se corrige en un click.
  it("todo VEVENT entra como reserva (isBlock=false), no como bloqueo", () => {
    const events = parseIcs(
      ics([vevent("bkg1@booking.com", "20261001", "20261005", "CLOSED - Not available")]),
      "booking",
    );
    expect(events).toHaveLength(1);
    expect(events[0].isBlock).toBe(false);
  });

  // La excepción a lo anterior es la duración. Nadie se aloja 183 noches por
  // Booking.com: eso es un marcador de ventana de disponibilidad, y el feed lo
  // regenera con UID nuevo todos los días. En producción (unidad BRASIL) eso
  // creaba una reserva "confirmada" de 6 meses por día — 31 en 20 días, ninguna
  // con número de reserva — que había que cancelar a mano.
  it("un VEVENT larguísimo entra como CIERRE, no como reserva", () => {
    const events = parseIcs(
      ics([vevent("mark1@booking.com", "20270901", "20280228", "CLOSED - Not available")]),
      "booking",
    );
    expect(events).toHaveLength(1);
    expect(events[0].isBlock).toBe(true);
  });

  it("una estadía larga pero plausible sigue siendo reserva", () => {
    // 120 noches es el corte; una mensualidad de 3-4 meses tiene que pasar.
    const events = parseIcs(
      ics([vevent("stay1@booking.com", "20261001", "20270101", "CLOSED - Not available")]),
      "booking",
    );
    expect(events[0].isBlock).toBe(false);
  });

  it("el corte no aplica a Airbnb (su feed sí distingue bloqueo de reserva)", () => {
    const events = parseIcs(
      ics([
        vevent(
          "abnb-long@airbnb.com",
          "20270901",
          "20280228",
          "Reserved",
          "Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMLONGSTAY",
        ),
      ]),
      "airbnb",
    );
    expect(events[0].isBlock).toBe(false);
  });
});

describe("toReservationEvent", () => {
  const base = {
    organizationId: "org-1",
    linkId: "link-1",
    unitId: "unit-1",
    channel: "airbnb" as const,
  };
  const ev = {
    uid: "abc@airbnb.com",
    checkIn: "2026-08-15",
    checkOut: "2026-08-18",
    summary: "Reserved",
    isBlock: false,
    confirmationCode: "HMXYZ12345",
  };

  it("el mismo contenido produce la misma dedupe key (idempotencia)", () => {
    const a = toReservationEvent({ ...base, event: ev });
    const b = toReservationEvent({ ...base, event: { ...ev } });
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it("un cambio de fechas produce una dedupe key distinta (modificación = evento nuevo)", () => {
    const a = toReservationEvent({ ...base, event: ev });
    const b = toReservationEvent({ ...base, event: { ...ev, checkOut: "2026-08-19" } });
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it("intervalos half-open: el check-out queda como DTEND exclusivo", () => {
    const a = toReservationEvent({ ...base, event: ev });
    expect(a.checkIn).toBe("2026-08-15");
    expect(a.checkOut).toBe("2026-08-18");
  });
});
