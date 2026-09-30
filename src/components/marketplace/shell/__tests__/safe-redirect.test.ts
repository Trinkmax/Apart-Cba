import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "../safe-redirect";

describe("safeRedirectPath", () => {
  it("acepta rutas internas con query y hash", () => {
    expect(safeRedirectPath("/mi-cuenta")).toBe("/mi-cuenta");
    expect(safeRedirectPath("/checkout/abc?checkin=2026-10-03&checkout=2026-10-06&huespedes=2")).toBe(
      "/checkout/abc?checkin=2026-10-03&checkout=2026-10-06&huespedes=2",
    );
    expect(safeRedirectPath("/como-reservar#pagos")).toBe("/como-reservar#pagos");
    expect(safeRedirectPath("/reset-password")).toBe("/reset-password");
  });

  it("rechaza destinos externos o raros", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "evil.com",
      "javascript:alert(1)",
      "",
      "   ",
    ]) {
      expect(safeRedirectPath(bad), JSON.stringify(bad)).toBe(DEFAULT_AFTER_LOGIN);
    }
    expect(safeRedirectPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath(`/${"a".repeat(600)}`)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("no vuelve a las pantallas de ingreso (loops)", () => {
    expect(safeRedirectPath("/ingresar")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath("/ingresar?redirect=/x")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath("/registrarse")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath("/auth/callback?code=1")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeRedirectPath("/ingresarse-no-existe")).toBe("/ingresarse-no-existe");
  });

  it("usa el fallback pedido", () => {
    expect(safeRedirectPath("//evil.com", "/")).toBe("/");
  });
});
