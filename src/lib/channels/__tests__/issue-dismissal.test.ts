import { describe, expect, it } from "vitest";
import { isSameSituation } from "../issue-dismissal";

describe("isSameSituation", () => {
  // Cofico Ideal (Habitana, 18/11/2026): el conflicto que Cecilia marcó «controlada».
  const dismissed = {
    booking_id: null,
    title: "Conflicto de disponibilidad con Booking",
    detail:
      "Booking vendió 2026-11-22 → 2026-11-25 pero esas fechas ya están ocupadas localmente en la unidad. La reserva local se mantiene; resolvé el conflicto (reubicar o cancelar en la OTA).",
  };

  it("el reintento de cada hora trae el mismo aviso: no vuelve", () => {
    expect(isSameSituation(dismissed, { ...dismissed })).toBe(true);
  });

  it("si la OTA cambia las fechas, es otra situación y vuelve a avisar", () => {
    const otherDates = { ...dismissed, detail: dismissed.detail.replace("2026-11-25", "2026-11-26") };
    expect(isSameSituation(dismissed, otherDates)).toBe(false);
  });

  it("si choca con otra reserva local, también", () => {
    expect(isSameSituation(dismissed, { ...dismissed, booking_id: "b-otra" })).toBe(false);
  });

  it("un aviso sin detalle se compara igual", () => {
    expect(isSameSituation({ ...dismissed, detail: null }, { ...dismissed, detail: "" })).toBe(true);
  });
});
