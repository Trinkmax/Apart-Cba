import { describe, expect, it } from "vitest";
import { normalizeMapsUrl } from "../guest-info";

describe("normalizeMapsUrl", () => {
  it("vacío es sin link", () => {
    expect(normalizeMapsUrl("")).toEqual({ ok: true, url: null });
    expect(normalizeMapsUrl("   ")).toEqual({ ok: true, url: null });
    expect(normalizeMapsUrl(null)).toEqual({ ok: true, url: null });
  });

  it("deja tal cual un link completo (sin espacios alrededor)", () => {
    expect(normalizeMapsUrl("  https://maps.app.goo.gl/AbC123 ")).toEqual({
      ok: true,
      url: "https://maps.app.goo.gl/AbC123",
    });
  });

  it("le agrega https:// al link copiado sin esquema", () => {
    expect(normalizeMapsUrl("maps.app.goo.gl/AbC123")).toEqual({
      ok: true,
      url: "https://maps.app.goo.gl/AbC123",
    });
  });

  it("rechaza lo que no es una dirección web", () => {
    expect(normalizeMapsUrl("Tucumán 2250").ok).toBe(false);
    expect(normalizeMapsUrl("javascript://alert(1)").ok).toBe(false);
    expect(normalizeMapsUrl("ftp://maps.example.com/x").ok).toBe(false);
  });
});
