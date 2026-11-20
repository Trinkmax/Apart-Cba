import { describe, expect, it } from "vitest";
import { findSameListing, type OtherLinkRow } from "../same-listing";

const now = Date.parse("2026-11-16T19:55:00Z"); // 16/11 16:55 en Córdoba
const row = (over: Partial<OtherLinkRow>): OtherLinkRow => ({
  link_id: "salguero",
  unit_id: "u-salguero",
  ical_uid: "a9fc90@booking.com",
  check_in: "2027-01-01",
  check_out: "2028-05-16",
  last_seen_at: "2026-11-16T19:20:00Z",
  ...over,
});

describe("findSameListing", () => {
  // Viaggiato, 16/11/2026 16:55: en CENTRO pegaron el calendario del anuncio
  // que estaba cargado en SALGUERO.
  it("el calendario trae entradas que otra conexión está leyendo: es su anuncio", () => {
    const r = findSameListing(
      ["a9fc90@booking.com", "afc5c5@booking.com"],
      [row({}), row({ ical_uid: "afc5c5@booking.com", check_in: "2026-11-18", check_out: "2026-11-20" })],
      now,
    );
    expect(r).toEqual({
      linkId: "salguero",
      unitId: "u-salguero",
      checkIn: "2026-11-18",
      checkOut: "2026-11-20",
      shared: 2,
    });
  });

  it("anuncios distintos con la misma fecha tienen otro identificador: no chocan", () => {
    expect(findSameListing(["otro@booking.com"], [row({})], now)).toBeNull();
    expect(findSameListing([], [row({})], now)).toBeNull();
  });

  // BALVA guarda una fila del anuncio de ABASTO desde el 28/10; ABASTO se
  // corrigió el 06/11. Volver a guardar el enlace bueno de ABASTO no se frena.
  it("una fila vieja de un error ya corregido no frena un enlace bueno", () => {
    expect(findSameListing(["a9fc90@booking.com"], [row({ last_seen_at: "2026-11-06T18:02:00Z" })], now)).toBeNull();
    expect(findSameListing(["a9fc90@booking.com"], [row({ last_seen_at: null })], now)).toBeNull();
  });

  it("con dos conexiones candidatas, la que comparte más", () => {
    const r = findSameListing(
      ["a@booking.com", "b@booking.com"],
      [
        row({ link_id: "x", ical_uid: "a@booking.com" }),
        row({ link_id: "y", ical_uid: "a@booking.com" }),
        row({ link_id: "y", ical_uid: "b@booking.com" }),
      ],
      now,
    );
    expect(r?.linkId).toBe("y");
    expect(r?.shared).toBe(2);
  });
});
