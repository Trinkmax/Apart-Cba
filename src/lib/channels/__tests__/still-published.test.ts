import { describe, expect, it } from "vitest";
import { isStillPublished, type PublishedRow } from "../still-published";

const now = Date.parse("2026-11-19T14:47:00Z");
const today = "2026-11-19";
const row = (over: Partial<PublishedRow> = {}): PublishedRow => ({
  external_status: "active",
  ical_uid: "7184e36895934971de82ff3b56945689@booking.com",
  last_seen_at: "2026-11-19T14:38:05Z",
  missing_since: null,
  check_out: "2026-12-07",
  ...over,
});

describe("isStillPublished", () => {
  // SAL648, 19/11/2026 11:47: la cancelaron a mano 9 minutos después de la
  // última vez que Booking la publicó.
  it("vista hace minutos: sigue publicada", () => {
    expect(isStillPublished(row(), today, now)).toBe(true);
  });

  it("vista hace una hora y media: todavía cuenta (se refresca una vez por hora)", () => {
    expect(isStillPublished(row({ last_seen_at: "2026-11-19T13:20:00Z" }), today, now)).toBe(true);
  });

  it("sin verla desde ayer: ya no está en el calendario de la OTA", () => {
    expect(isStillPublished(row({ last_seen_at: "2026-11-18T17:14:12Z" }), today, now)).toBe(false);
  });

  it("si ya la estamos contando como ausente, no", () => {
    expect(isStillPublished(row({ missing_since: "2026-11-19T14:44:00Z" }), today, now)).toBe(false);
  });

  it("una estadía que ya terminó no se puede vender dos veces", () => {
    expect(isStillPublished(row({ check_out: "2026-11-19" }), today, now)).toBe(false);
  });

  it("una fila archivada o cancelada no cuenta", () => {
    expect(isStillPublished(row({ ical_uid: "abc@booking.com#1234" }), today, now)).toBe(false);
    expect(isStillPublished(row({ external_status: "cancelled" }), today, now)).toBe(false);
  });

  it("la que entró por mail y nunca se vio en un calendario no dice nada", () => {
    expect(isStillPublished(row({ last_seen_at: null }), today, now)).toBe(false);
  });
});
