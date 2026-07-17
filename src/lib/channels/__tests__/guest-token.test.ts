import { describe, expect, it } from "vitest";
import {
  isGenericGuestName,
  normalizeEmail,
  normalizePhoneE164,
} from "@/lib/channels/guest";
import { generateExportToken, sha256Hex, tokenMatchesHash } from "@/lib/channels/token";

describe("normalización de huéspedes", () => {
  it("emails a lowercase, inválidos a null", () => {
    expect(normalizeEmail("  Juan.Perez@Example.COM ")).toBe("juan.perez@example.com");
    expect(normalizeEmail("no-es-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("teléfonos a E.164 solo cuando es inequívoco", () => {
    expect(normalizePhoneE164("+54 9 351 555-1234")).toBe("+5493515551234");
    expect(normalizePhoneE164("0054 351 5551234")).toBe("+543515551234");
    // sin código de país no se adivina
    expect(normalizePhoneE164("351 555 1234")).toBeNull();
    expect(normalizePhoneE164("+123")).toBeNull(); // demasiado corto
  });

  it("nombres genéricos no crean huéspedes", () => {
    for (const generic of [
      "Huésped Airbnb",
      "Huesped Booking",
      "Guest",
      "Blocked",
      "Reserved",
      "Not available",
      "CLOSED - Not available",
      "Airbnb",
      "ab",
      "",
    ]) {
      expect(isGenericGuestName(generic), `"${generic}" debería ser genérico`).toBe(true);
    }
    expect(isGenericGuestName("María González")).toBe(false);
    expect(isGenericGuestName("Juan Pérez")).toBe(false);
  });
});

describe("tokens del calendario saliente", () => {
  it("el hash SHA-256 verifica en tiempo constante", () => {
    const token = generateExportToken();
    const hash = sha256Hex(token);
    expect(tokenMatchesHash(token, hash)).toBe(true);
    expect(tokenMatchesHash("otro-token", hash)).toBe(false);
    expect(tokenMatchesHash(token, null)).toBe(false);
    expect(tokenMatchesHash("", hash)).toBe(false);
    expect(tokenMatchesHash(token, "no-es-hex!!")).toBe(false);
  });

  it("genera tokens de 32 hex chars (128 bits)", () => {
    expect(generateExportToken()).toMatch(/^[0-9a-f]{32}$/);
  });
});
