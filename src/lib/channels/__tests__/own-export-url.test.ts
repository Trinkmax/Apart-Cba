import { describe, expect, it } from "vitest";
import { isOwnExportFeedUrl } from "@/lib/channels/own-export-url";

const LINK = "b2e4d84c-6040-4b57-8973-5763424e7ad3";

describe("isOwnExportFeedUrl", () => {
  it("detecta el enlace de salida de rentOS pegado como calendario entrante", () => {
    // El caso real de VillaSol (Viaggiato, 09/11/2026).
    expect(
      isOwnExportFeedUrl(`https://www.apartcba.com/api/channels/ical/${LINK}.ics?token=abc123`),
    ).toBe(true);
  });

  it("detecta también el host sin www y la ruta legacy por unidad", () => {
    expect(isOwnExportFeedUrl(`https://apartcba.com/api/ical/${LINK}.ics?token=abc`)).toBe(true);
  });

  it("usa el host de la app configurada", () => {
    expect(
      isOwnExportFeedUrl(
        `https://app.rentos.test/api/channels/ical/${LINK}.ics?token=x`,
        "https://app.rentos.test",
      ),
    ).toBe(true);
  });

  it("deja pasar los calendarios de las OTAs", () => {
    expect(
      isOwnExportFeedUrl("https://www.airbnb.com.ar/calendar/ical/1752000.ics?t=abc"),
    ).toBe(false);
    expect(isOwnExportFeedUrl("https://ical.booking.com/v1/export?t=abc")).toBe(false);
  });

  it("no rechaza un .ics de otro sistema con una ruta parecida", () => {
    expect(isOwnExportFeedUrl(`https://otro-pms.com/api/ical/${LINK}.ics?token=x`)).toBe(false);
  });

  it("no rompe con basura", () => {
    expect(isOwnExportFeedUrl("no es una url")).toBe(false);
    expect(isOwnExportFeedUrl("", "tampoco")).toBe(false);
  });
});
