import { describe, expect, it } from "vitest";
import {
  coverageTone,
  cuitWarning,
  docLabel,
  formatDocNumber,
  incomeCoverage,
  isValidCuit,
  normalizeDocNumber,
  sanitizeSearchTerm,
  accentInsensitiveRegex,
  foldText,
} from "../person-helpers";

describe("documentos", () => {
  it("normaliza DNI y CUIT a cifras", () => {
    expect(normalizeDocNumber("DNI", " 30.123.456 ")).toBe("30123456");
    expect(normalizeDocNumber("CUIT", "20-30123456-7")).toBe("20301234567");
    expect(normalizeDocNumber("PASAPORTE", " aa 123 ")).toBe("AA 123");
    expect(normalizeDocNumber("DNI", "  ")).toBeNull();
  });
  it("formatea para mostrar", () => {
    expect(formatDocNumber("DNI", "30123456")).toBe("30.123.456");
    expect(formatDocNumber("CUIT", "20301234567")).toBe("20-30123456-7");
    expect(formatDocNumber("PASAPORTE", "AA123")).toBe("AA123");
    expect(docLabel("DNI", "30123456")).toBe("DNI 30.123.456");
    expect(docLabel("PASAPORTE", "AA123")).toBe("Pasaporte AA123");
    expect(docLabel("DNI", null)).toBe("");
  });
});

describe("CUIT", () => {
  it("valida el dígito verificador", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("33-69345023-9")).toBe(true);
    expect(isValidCuit("20-12345678-5")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
  });
  it("avisa sin bloquear", () => {
    expect(cuitWarning("")).toBeNull();
    expect(cuitWarning("20-12345678-6")).toBeNull();
    expect(cuitWarning("123")).toContain("11 cifras");
    expect(cuitWarning("20-12345678-5")).toContain("Revisá");
  });
});

describe("búsqueda e ingresos", () => {
  it("limpia el término para PostgREST", () => {
    expect(sanitizeSearchTerm("  pérez, (juan)%  ")).toBe("pérez juan");
    expect(sanitizeSearchTerm(null)).toBe("");
  });
  it("calcula cuánto cubren los ingresos", () => {
    expect(incomeCoverage(1_500_000, 500_000)).toBe(3);
    expect(incomeCoverage(1_000_000, 450_000)).toBe(2.2);
    expect(incomeCoverage(null, 500_000)).toBeNull();
    expect(coverageTone(3.1)).toBe("ok");
    expect(coverageTone(2.2)).toBe("warn");
    expect(coverageTone(1.5)).toBe("low");
    expect(coverageTone(null)).toBeNull();
  });
});

describe("accentInsensitiveRegex", () => {
  it("encuentra con o sin tildes y eñes", () => {
    const re = (w: string) => new RegExp(accentInsensitiveRegex(w), "i");
    expect(re("munoz").test("Ana Muñoz")).toBe(true);
    expect(re("Muñoz").test("ANA MUNOZ")).toBe(true);
    expect(re("perez").test("Juan Pérez")).toBe(true);
    expect(re("gomez").test("Juan Pérez")).toBe(false);
  });
  it("descarta metacaracteres", () => {
    expect(accentInsensitiveRegex("a.*(b)")).toBe("[aáàäâAÁÀÄÂ]b");
    expect(foldText("Núñez")).toBe("nunez");
  });
});
