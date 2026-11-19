import { describe, expect, it } from "vitest";
import { cancellationDoubts, type DoubtFacts } from "../cancellation-doubts";

const now = new Date("2026-11-19T14:22:00Z");

const base: DoubtFacts = {
  channel: "booking",
  reasonCode: "ota_cancellation_email",
  requestedAt: "2026-11-18T18:16:44Z",
  bookingSource: "booking",
  handLoaded: false,
  reservation: { last_seen_at: "2026-11-18T18:10:00Z", missing_since: null },
};

describe("cancellationDoubts", () => {
  it("sin nada que contradiga, no dice nada", () => {
    expect(cancellationDoubts(base, now)).toEqual([]);
  });

  // DIVA, 19/11/2026: el mail de cancelación era de VEL727 y Booking seguía
  // publicando la reserva de DIVA al día siguiente.
  it("avisa cuando la OTA la sigue publicando mucho después del mail", () => {
    const doubts = cancellationDoubts(
      { ...base, reservation: { last_seen_at: "2026-11-19T13:38:05Z", missing_since: null } },
      now,
    );
    expect(doubts).toHaveLength(1);
    expect(doubts[0]).toContain("Booking la sigue mostrando");
    expect(doubts[0]).toContain("hace 44 min");
  });

  it("verla unos minutos después del mail todavía no contradice (el feed tarda)", () => {
    const doubts = cancellationDoubts(
      { ...base, reservation: { last_seen_at: "2026-11-18T18:26:00Z", missing_since: null } },
      now,
    );
    expect(doubts).toEqual([]);
  });

  it("si ya la estamos contando como ausente, no contradice", () => {
    const doubts = cancellationDoubts(
      {
        ...base,
        reservation: { last_seen_at: "2026-11-19T13:38:05Z", missing_since: "2026-11-19T13:44:00Z" },
      },
      now,
    );
    expect(doubts).toEqual([]);
  });

  it("una que desapareció y volvió al calendario lo dice", () => {
    const doubts = cancellationDoubts(
      {
        ...base,
        reasonCode: "missing_from_feed",
        reservation: { last_seen_at: "2026-11-19T14:20:00Z", missing_since: null },
      },
      now,
    );
    expect(doubts[0]).toContain("Volvió a aparecer en el calendario de Booking");
  });

  // BRASIL, 14/11/2026: reserva directa con $300.000 cobrados.
  it("avisa cuando la reserva la cargaron ellos y no es de ese canal", () => {
    const doubts = cancellationDoubts(
      { ...base, bookingSource: "directo", handLoaded: true, reservation: null },
      now,
    );
    expect(doubts).toEqual([
      "Esta reserva la cargaron ustedes como directa: no entró por Booking. El aviso puede ser de otra reserva.",
    ]);
  });

  it("una de Booking anotada a mano con su origen no levanta esa duda", () => {
    expect(cancellationDoubts({ ...base, handLoaded: true, reservation: null }, now)).toEqual([]);
  });

  it("una de Airbnb cargada a mano, frente a un aviso de Booking", () => {
    const doubts = cancellationDoubts(
      { ...base, bookingSource: "airbnb", handLoaded: true, reservation: null },
      now,
    );
    expect(doubts[0]).toContain("con origen Airbnb");
  });
});
