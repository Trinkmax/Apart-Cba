import { describe, expect, it } from "vitest";
import { formatTimeInTz, otaRefreshUrl } from "../publication-copy";

describe("formatTimeInTz", () => {
  const now = new Date("2026-11-19T14:20:00Z"); // 11:20 en Córdoba

  it("la hora de Córdoba, no la del servidor", () => {
    expect(formatTimeInTz("2026-11-19T14:52:25Z", now)).toBe("11:52");
  });

  it("si cae al otro día, lo dice", () => {
    expect(formatTimeInTz("2026-11-20T03:10:00Z", now)).toBe("mañana 00:10");
  });

  it("antes de medianoche de Córdoba sigue siendo hoy aunque en UTC ya sea mañana", () => {
    expect(formatTimeInTz("2026-11-20T02:52:00Z", now)).toBe("23:52");
  });

  it("una fecha ilegible no rompe", () => {
    expect(formatTimeInTz("no-es-una-fecha", now)).toBe("—");
  });
});

describe("otaRefreshUrl", () => {
  it("el anuncio de Airbnb, si se conoce", () => {
    expect(otaRefreshUrl("airbnb", "1240475750018095639")).toBe(
      "https://www.airbnb.com/multicalendar/1240475750018095639/availability-settings",
    );
  });

  it("sin anuncio, o con algo que no es un id, no arma nada", () => {
    expect(otaRefreshUrl("airbnb", null)).toBeNull();
    expect(otaRefreshUrl("airbnb", "javascript:alert(1)")).toBeNull();
  });

  it("Booking no tiene un atajo por anuncio", () => {
    expect(otaRefreshUrl("booking", "17074878")).toBeNull();
  });
});
