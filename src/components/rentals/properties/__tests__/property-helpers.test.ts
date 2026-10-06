import { describe, expect, it } from "vitest";
import {
  findCodeClash,
  firstFreeCode,
  normalizePropertyCode,
  propertyDisplayState,
  propertyFeatures,
  sinceLabel,
  splitEvenly,
  suggestPropertyCode,
  validateOwnership,
} from "../property-helpers";

describe("suggestPropertyCode", () => {
  it("arma calle + número + piso y depto", () => {
    expect(suggestPropertyCode({ street: "Dean Funes", street_number: "450", floor: "3", apartment: "B" })).toBe("DEANFUNES450-3B");
  });
  it("saca el tipo de calle, los acentos y los conectores", () => {
    expect(suggestPropertyCode({ street: "Av. Colón", street_number: "1234", floor: "10", apartment: "A" })).toBe("COLON1234-10A");
    expect(suggestPropertyCode({ street: "27 de Abril", street_number: "300" })).toBe("27ABRIL300");
    expect(suggestPropertyCode({ street: "Bv. San Juan", street_number: "500" })).toBe("SANJUAN500");
  });
  it("agrega la torre y acota calles largas", () => {
    expect(suggestPropertyCode({ street: "Obispo Trejo y Sanabria", street_number: "50", tower: "2", floor: "PB", apartment: "1" })).toBe(
      "OBISPOTREJOSAN50-T2-PB1",
    );
  });
  it("sin calle no sugiere nada", () => {
    expect(suggestPropertyCode({ street: "", street_number: "450" })).toBe("");
    expect(suggestPropertyCode({})).toBe("");
  });
  it("una calle que es sólo un prefijo se conserva", () => {
    expect(suggestPropertyCode({ street: "Ruta", street_number: "9" })).toBe("RUTA9");
  });
});

describe("normalizePropertyCode / firstFreeCode", () => {
  it("normaliza lo tipeado", () => {
    expect(normalizePropertyCode("  deán funes 450 3°b ")).toBe("DEAN-FUNES-450-3B");
    expect(normalizePropertyCode("--a--b--")).toBe("A-B");
    expect(normalizePropertyCode("x".repeat(60))).toHaveLength(40);
  });
  it("busca el primer libre sin distinguir mayúsculas", () => {
    expect(firstFreeCode("DF450", [])).toBe("DF450");
    expect(firstFreeCode("DF450", ["df450", "DF450-2"])).toBe("DF450-3");
  });
});

describe("findCodeClash", () => {
  const codes = [
    { id: "p1", code: "DEANFUNES450-3B", label: "Dean Funes 450, 3° B" },
    { id: "p2", code: "DEANFUNES450-3B-2", label: "Dean Funes 450, 3° B (otra)" },
  ];
  it("avisa el choque con lo tipeado normalizado y propone uno libre", () => {
    expect(findCodeClash(codes, null, " deanfunes450-3b ")).toEqual({ code: "DEANFUNES450-3B", label: "Dean Funes 450, 3° B", fix: "DEANFUNES450-3B-3" });
  });
  it("vacío o libre no choca", () => {
    expect(findCodeClash(codes, null, "")).toBeNull();
    expect(findCodeClash(codes, null, "COLON100")).toBeNull();
  });
  it("la propia propiedad no choca consigo misma (edición o alta ya guardada)", () => {
    expect(findCodeClash(codes, "p1", "DEANFUNES450-3B")).toBeNull();
  });
});

describe("validateOwnership", () => {
  const row = (owner_id: string, ownership_pct: number, is_primary = false) => ({ owner_id, ownership_pct, is_primary });
  it("acepta un dueño al 100 % principal", () => {
    expect(validateOwnership([row("a", 100, true)])).toEqual({ ok: true });
  });
  it("acepta 33,34 + 33,33 + 33,33", () => {
    expect(validateOwnership([row("a", 33.34, true), row("b", 33.33), row("c", 33.33)])).toEqual({ ok: true });
  });
  it("rechaza vacío, repetidos, % fuera de rango y sumas distintas de 100", () => {
    expect(validateOwnership([]).ok).toBe(false);
    expect(validateOwnership([row("a", 50, true), row("a", 50)]).ok).toBe(false);
    expect(validateOwnership([row("a", 0, true), row("b", 100)]).ok).toBe(false);
    const r = validateOwnership([row("a", 60, true), row("b", 30)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("falta 10 %");
  });
  it("exige exactamente un principal", () => {
    expect(validateOwnership([row("a", 50), row("b", 50)]).ok).toBe(false);
    expect(validateOwnership([row("a", 50, true), row("b", 50, true)]).ok).toBe(false);
  });
});

describe("splitEvenly", () => {
  it("reparte y suma exactamente 100", () => {
    expect(splitEvenly(1)).toEqual([100]);
    expect(splitEvenly(2)).toEqual([50, 50]);
    expect(splitEvenly(3)).toEqual([33.34, 33.33, 33.33]);
    const six = splitEvenly(6);
    expect(Math.round(six.reduce((s, x) => s + x, 0) * 100) / 100).toBe(100);
    expect(splitEvenly(0)).toEqual([]);
  });
});

describe("propertyDisplayState / propertyFeatures / sinceLabel", () => {
  it("prioriza archivada y alquilada", () => {
    expect(propertyDisplayState({ active: false, availability: "disponible" }, true)).toBe("archivada");
    expect(propertyDisplayState({ active: true, availability: "en_refaccion" }, true)).toBe("alquilada");
    expect(propertyDisplayState({ active: true, availability: "en_refaccion" }, false)).toBe("en_refaccion");
    expect(propertyDisplayState({ active: true, availability: "disponible" }, false)).toBe("vacante");
  });
  it("lista las características", () => {
    expect(
      propertyFeatures({ rooms: 1, bedrooms: null, bathrooms: 1, covered_m2: 32.5, total_m2: null, furnished: true, has_garage: false }),
    ).toEqual(["Monoambiente", "1 baño", "32,5 m²", "Amoblado"]);
  });
  it("dice hace cuánto", () => {
    expect(sinceLabel("2026-10-02", "2026-10-02")).toBe("desde hoy");
    expect(sinceLabel("2026-09-20", "2026-10-02")).toBe("hace 12 días");
    expect(sinceLabel("2026-07-01", "2026-10-02")).toBe("hace 3 meses");
    expect(sinceLabel("2025-08-01", "2026-10-02")).toBe("hace 1 año y 2 meses");
  });
});
