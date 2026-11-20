import { describe, expect, it } from "vitest";
import { isFeedLinkGone, siblingChangedNearby, siblingsThatJustDied } from "../link-gone";

// Lo que contesta Booking por un enlace cuya conexión se borró (20/11/2026).
const INVALID_TOKEN = '{"detail":"Invalid Token","instance":"/v1/export","status":400,"title":"Bad Request"}';

describe("isFeedLinkGone", () => {
  it("Booking 400 «Invalid Token»: el enlace se dio de baja", () => {
    expect(isFeedLinkGone("booking", 400, INVALID_TOKEN)).toBe(true);
  });

  it("un 400 sin ese texto, un 5xx o un 404 siguen por el camino de siempre", () => {
    expect(isFeedLinkGone("booking", 400, "")).toBe(false);
    expect(isFeedLinkGone("booking", 400, "<html>Bad Request</html>")).toBe(false);
    expect(isFeedLinkGone("booking", 503, INVALID_TOKEN)).toBe(false);
    expect(isFeedLinkGone("booking", 404, null)).toBe(false);
  });

  it("sólo se verificó en Booking", () => {
    expect(isFeedLinkGone("airbnb", 400, INVALID_TOKEN)).toBe(false);
  });
});

describe("siblingChangedNearby", () => {
  const at = (hhmm: string) => `2026-11-20T${hhmm}:00Z`;
  // SALGUERO dejó de leerse a las 12:02 ART; a las 12:14 se cargó el de CENTRO.
  const gone = Date.parse(at("15:02"));

  it("encuentra el cambio de enlace de otra conexión alrededor de la caída", () => {
    expect(siblingChangedNearby([{ unitCode: "CENTRO", changedAt: at("15:14") }], gone)).toEqual({
      unitCode: "CENTRO",
      changedAt: at("15:14"),
    });
    // 16/11 y 18/11: el otro murió DESPUÉS del cambio
    expect(siblingChangedNearby([{ unitCode: "CENTRO", changedAt: at("14:43") }], gone)?.unitCode).toBe("CENTRO");
  });

  it("un cambio de hace horas no tiene nada que ver", () => {
    expect(siblingChangedNearby([{ unitCode: "VELEZ", changedAt: at("11:00") }], gone)).toBeNull();
    expect(siblingChangedNearby([{ unitCode: "CALA", changedAt: null }], gone)).toBeNull();
  });

  it("con varios, el más cercano", () => {
    const r = siblingChangedNearby(
      [
        { unitCode: "VELEZ", changedAt: at("14:10") },
        { unitCode: "CENTRO", changedAt: at("15:14") },
      ],
      gone,
    );
    expect(r?.unitCode).toBe("CENTRO");
  });
});

describe("siblingsThatJustDied", () => {
  const now = Date.parse("2026-11-20T15:14:00Z");
  it("las conexiones que dejaron de funcionar en la última hora y media", () => {
    const r = siblingsThatJustDied(
      [
        { unitCode: "SALGUERO", consecutiveFailures: 2, lastSuccessAt: "2026-11-20T15:02:00Z", lastError: "HTTP 400" },
        { unitCode: "GAMA", consecutiveFailures: 0, lastSuccessAt: "2026-11-20T15:10:00Z", lastError: null },
        { unitCode: "VIEJA", consecutiveFailures: 40, lastSuccessAt: "2026-11-18T10:00:00Z", lastError: "HTTP 400" },
        { unitCode: "NUNCA", consecutiveFailures: 3, lastSuccessAt: null, lastError: "HTTP 400" },
        // una lectura suelta que falló por la red no es un enlace dado de baja
        { unitCode: "LENTA", consecutiveFailures: 1, lastSuccessAt: "2026-11-20T15:08:00Z", lastError: "The operation was aborted due to timeout" },
        { unitCode: "CAIDA", consecutiveFailures: 1, lastSuccessAt: "2026-11-20T15:08:00Z", lastError: "HTTP 503" },
      ],
      now,
    );
    expect(r).toEqual([{ unitCode: "SALGUERO", lastSuccessAt: "2026-11-20T15:02:00Z" }]);
  });

  it("también cuando ya quedó marcado como dado de baja", () => {
    const r = siblingsThatJustDied(
      [{ unitCode: "SALGUERO", consecutiveFailures: 1, lastSuccessAt: "2026-11-20T15:02:00Z", lastError: "El enlace ya no existe en Booking" }],
      now,
    );
    expect(r).toHaveLength(1);
  });
});

describe("fetchIcalFeed", () => {
  it("marca el enlace como dado de baja y no como un fallo cualquiera", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "34.120.10.10", family: 4 }]) }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(INVALID_TOKEN, { status: 400, headers: { "content-type": "application/problem+json" } }),
      ),
    );
    try {
      const { fetchIcalFeed } = await import("../ical-adapter");
      const gone = await fetchIcalFeed({ feedUrl: "https://ical.booking.com/v1/export?t=borrado", channel: "booking" });
      expect(gone).toMatchObject({ status: "http_error", httpStatus: 400, linkGone: true });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream timeout", { status: 400 })));
      const flaky = await fetchIcalFeed({ feedUrl: "https://ical.booking.com/v1/export?t=x", channel: "booking" });
      expect(flaky).toMatchObject({ status: "http_error", httpStatus: 400, linkGone: false });
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("dns/promises");
      vi.resetModules();
    }
  });
});
