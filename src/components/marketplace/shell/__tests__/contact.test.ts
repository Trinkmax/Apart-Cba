import { describe, expect, it } from "vitest";
import {
  EMPTY_SHELL_CONTACT,
  SITE_WHATSAPP_MESSAGE,
  buildShellContact,
  cleanInstagramHandle,
  hasAnyContact,
} from "../contact";

describe("cleanInstagramHandle", () => {
  it("acepta el usuario con o sin arroba y con URL", () => {
    expect(cleanInstagramHandle("apartcba")).toBe("apartcba");
    expect(cleanInstagramHandle("@apart.cba")).toBe("apart.cba");
    expect(cleanInstagramHandle("instagram.com/apartcba/")).toBe("apartcba");
    expect(cleanInstagramHandle("https://www.instagram.com/apart_cba?hl=es")).toBe("apart_cba");
  });

  it("descarta valores vacíos o inválidos", () => {
    expect(cleanInstagramHandle(null)).toBeNull();
    expect(cleanInstagramHandle("   ")).toBeNull();
    expect(cleanInstagramHandle("apart cba")).toBeNull();
  });
});

describe("buildShellContact", () => {
  it("arma WhatsApp, mail e Instagram", () => {
    const c = buildShellContact({
      whatsappNumber: "5493515639985",
      publicEmail: " hola@apartcba.com ",
      instagramHandle: "@apartcba",
      responseHours: 12,
    });
    expect(c.whatsappUrl).toBe(
      `https://wa.me/5493515639985?text=${encodeURIComponent(SITE_WHATSAPP_MESSAGE)}`,
    );
    expect(c.whatsappLabel).toBe("+54 9 351 563-9985");
    expect(c.email).toBe("hola@apartcba.com");
    expect(c.emailUrl).toBe("mailto:hola@apartcba.com");
    expect(c.instagramUrl).toBe("https://www.instagram.com/apartcba/");
    expect(c.responseHours).toBe(12);
    expect(hasAnyContact(c)).toBe(true);
  });

  it("sin datos no inventa nada", () => {
    expect(EMPTY_SHELL_CONTACT).toEqual({
      whatsappUrl: null,
      whatsappLabel: null,
      email: null,
      emailUrl: null,
      instagramHandle: null,
      instagramUrl: null,
      responseHours: 24,
    });
    expect(hasAnyContact(EMPTY_SHELL_CONTACT)).toBe(false);
  });

  it("ignora un número corto o un mail mal formado", () => {
    const c = buildShellContact({ whatsappNumber: "351", publicEmail: "hola@", responseHours: 0 });
    expect(c.whatsappUrl).toBeNull();
    expect(c.whatsappLabel).toBeNull();
    expect(c.email).toBeNull();
    expect(c.responseHours).toBe(24);
  });
});
