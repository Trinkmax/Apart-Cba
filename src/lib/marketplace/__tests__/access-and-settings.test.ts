import { describe, expect, it } from "vitest";
import {
  deriveAccessToken,
  hashAccessToken,
  isWellFormedAccessToken,
  tokenMatchesRequest,
} from "@/lib/marketplace/access-token";
import { hoursLabel, resolveWebSettings } from "@/lib/marketplace/web-settings";
import { absoluteUrl, normalizeAppUrl } from "@/lib/app-url";

const SECRET = "secreto-de-prueba";
const REQ_A = "6f1f2a2e-1111-4a4a-8b8b-000000000001";
const REQ_B = "6f1f2a2e-1111-4a4a-8b8b-000000000002";

describe("access token del link de seguimiento", () => {
  it("43 caracteres base64url, estable por solicitud y distinto entre solicitudes", () => {
    const a = deriveAccessToken(REQ_A, SECRET);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveAccessToken(REQ_A, SECRET)).toBe(a);
    expect(deriveAccessToken(REQ_B, SECRET)).not.toBe(a);
    expect(isWellFormedAccessToken(a)).toBe(true);
  });
  it("depende del secreto (sin él no se puede armar)", () => {
    expect(deriveAccessToken(REQ_A, "otro")).not.toBe(deriveAccessToken(REQ_A, SECRET));
  });
  it("verifica en tiempo constante", () => {
    const t = deriveAccessToken(REQ_A, SECRET);
    expect(tokenMatchesRequest(t, REQ_A, SECRET)).toBe(true);
    expect(tokenMatchesRequest(t, REQ_B, SECRET)).toBe(false);
    expect(tokenMatchesRequest("corto", REQ_A, SECRET)).toBe(false);
  });
  it("se guarda el sha256, nunca el token", () => {
    const t = deriveAccessToken(REQ_A, SECRET);
    const h = hashAccessToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashAccessToken(t)).toBe(h);
  });
  it("rechaza basura antes de ir a la base", () => {
    expect(isWellFormedAccessToken("")).toBe(false);
    expect(isWellFormedAccessToken("abc")).toBe(false);
    expect(isWellFormedAccessToken("x".repeat(43) + "'")).toBe(false);
    expect(isWellFormedAccessToken(null)).toBe(false);
  });
});

describe("resolveWebSettings", () => {
  it("sin fila: seña de 1 noche, 24 h, sin datos de transferencia", () => {
    const s = resolveWebSettings(null, { email: "hola@apart.test" });
    expect(s.deposit).toEqual({ rule: "one_night", percent: null, dueHours: 24 });
    expect(s.responseHours).toBe(24);
    expect(s.transfer).toBeNull();
    expect(s.publicEmail).toBe("hola@apart.test");
    expect(s.whatsappNumber).toBeNull();
  });
  it("normaliza whatsapp, instagram y exige CBU o alias para mostrar datos", () => {
    const s = resolveWebSettings({
      whatsapp_number: "5493515639985",
      instagram_handle: "@departamentostemporarios_cba",
      transfer_holder: "Apart CBA SAS",
      transfer_alias: " apart.cba ",
      deposit_rule: "percent",
      deposit_percent: 30,
      deposit_due_hours: 12,
      response_hours: 6,
    });
    expect(s.whatsappNumber).toBe("5493515639985");
    expect(s.instagramHandle).toBe("departamentostemporarios_cba");
    expect(s.transfer?.alias).toBe("apart.cba");
    expect(s.deposit).toEqual({ rule: "percent", percent: 30, dueHours: 12 });
    expect(s.responseHours).toBe(6);
    expect(resolveWebSettings({ transfer_holder: "Solo titular" }).transfer).toBeNull();
  });
  it("un porcentaje sin valor cae a 1 noche", () => {
    expect(resolveWebSettings({ deposit_rule: "percent", deposit_percent: null }).deposit.rule).toBe("one_night");
  });
  it("hoursLabel", () => {
    expect(hoursLabel(1)).toBe("1 hora");
    expect(hoursLabel(24)).toBe("24 horas");
    expect(hoursLabel(48)).toBe("2 días");
  });
});

describe("app url", () => {
  it("saca el salto de línea y la barra final que rompían el sitemap", () => {
    expect(normalizeAppUrl("https://www.apartcba.com\n")).toBe("https://www.apartcba.com");
    expect(normalizeAppUrl("https://www.apartcba.com/ ")).toBe("https://www.apartcba.com");
    expect(normalizeAppUrl("")).toBe("https://www.apartcba.com");
    expect(normalizeAppUrl(undefined)).toBe("https://www.apartcba.com");
  });
  it("absoluteUrl", () => {
    expect(absoluteUrl("/u/rondeau-ii")).toMatch(/\/u\/rondeau-ii$/);
    expect(absoluteUrl("buscar")).toMatch(/[^/]\/buscar$/);
  });
});
