import { describe, expect, it } from "vitest";
import { isBookingWindowMarker, isLongRangeMarker, isWindowEdgeMarker } from "@/lib/channels/booking-window";

describe("marcas de la ventana de Booking", () => {
  it("más de 120 noches no es una estadía", () => {
    expect(isLongRangeMarker("2027-08-20", "2028-02-19")).toBe(true);
    expect(isLongRangeMarker("2026-10-01", "2027-01-01")).toBe(false); // 92 noches: mensual real
  });

  it("una llegada a 500 días o más es el borde de la ventana", () => {
    expect(isWindowEdgeMarker("2028-05-09", "2026-11-09")).toBe(true); // 547 días
    expect(isWindowEdgeMarker("2027-11-10", "2026-11-12")).toBe(false); // 363 días
  });

  it("combina las dos", () => {
    expect(isBookingWindowMarker({ checkIn: "2028-03-08", checkOut: "2028-03-10" }, "2026-09-13")).toBe(true);
    expect(isBookingWindowMarker({ checkIn: "2026-12-05", checkOut: "2026-12-09" }, "2026-10-24")).toBe(false);
  });
});
