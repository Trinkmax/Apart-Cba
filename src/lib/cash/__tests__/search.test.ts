import { describe, expect, it } from "vitest";
import {
  CASH_SEARCH_MAX_TOKENS,
  cashSearchTokenFilter,
  foldSearch,
  highlightSegments,
  isCashSearchActive,
  parseCashSearch,
} from "@/lib/cash/search";

describe("foldSearch", () => {
  it("baja a minúsculas y saca tildes, diéresis, ñ y ç (espejo de apartcba.search_fold)", () => {
    expect(foldSearch("Vélez Sarsfield")).toBe("velez sarsfield");
    expect(foldSearch("PEÑA Güemes Çelik")).toBe("pena guemes celik");
    expect(foldSearch("Reparaciòn")).toBe("reparacion");
  });

  it("también normaliza texto que ya viene descompuesto (teclado de Mac)", () => {
    expect(foldSearch("José")).toBe("jose");
  });
});

describe("parseCashSearch", () => {
  it("parte por espacios, normaliza y descarta repetidos", () => {
    expect(parseCashSearch("  Juan   PÉREZ juan ")).toEqual([
      { text: "juan", amount: null },
      { text: "perez", amount: null },
    ]);
  });

  it("vacío o nulo no busca nada", () => {
    expect(parseCashSearch("")).toEqual([]);
    expect(parseCashSearch("   ")).toEqual([]);
    expect(parseCashSearch(null)).toEqual([]);
  });

  it("un importe en formato es-AR también matchea por valor", () => {
    expect(parseCashSearch("15.000")).toEqual([{ text: "15.000", amount: 15000 }]);
    expect(parseCashSearch("$15000")).toEqual([{ text: "15000", amount: 15000 }]);
    expect(parseCashSearch("1.500,50")).toEqual([{ text: "1.500,50", amount: 1500.5 }]);
  });

  it("texto con números no es un importe", () => {
    expect(parseCashSearch("IND-369")).toEqual([{ text: "ind-369", amount: null }]);
    expect(parseCashSearch("4B")).toEqual([{ text: "4b", amount: null }]);
  });

  it("saca los comodines y la sintaxis de PostgREST", () => {
    expect(parseCashSearch('a%b_c*"(x):y\\z')).toEqual([{ text: "abcxyz", amount: null }]);
    expect(parseCashSearch('%%% "" ()')).toEqual([]);
  });

  it("corta en el máximo de tokens", () => {
    const many = Array.from({ length: 10 }, (_, i) => `t${i}`).join(" ");
    expect(parseCashSearch(many)).toHaveLength(CASH_SEARCH_MAX_TOKENS);
  });
});

describe("isCashSearchActive", () => {
  it("una sola letra todavía no busca; dos sí", () => {
    expect(isCashSearchActive("j")).toBe(false);
    expect(isCashSearchActive("ju")).toBe(true);
  });

  it("un importe busca aunque sea corto", () => {
    expect(isCashSearchActive("5")).toBe(true);
  });

  it("sólo basura no busca", () => {
    expect(isCashSearchActive("%%")).toBe(false);
  });
});

describe("cashSearchTokenFilter", () => {
  it("texto: ILIKE sobre search_text, entre comillas", () => {
    expect(cashSearchTokenFilter({ text: "velez", amount: null })).toBe(
      'search_text.ilike."%velez%"',
    );
  });

  it("importe: texto O importe exacto", () => {
    expect(cashSearchTokenFilter({ text: "1.500,50", amount: 1500.5 })).toBe(
      'search_text.ilike."%1.500,50%",amount.eq."1500.5"',
    );
  });
});

describe("highlightSegments", () => {
  it("resalta sin importar tildes ni mayúsculas", () => {
    expect(highlightSegments("Av. Vélez 620", ["velez"])).toEqual([
      { text: "Av. ", match: false },
      { text: "Vélez", match: true },
      { text: " 620", match: false },
    ]);
  });

  it("varias apariciones y varios tokens; los solapados se unen", () => {
    expect(highlightSegments("Juan Juana", ["juan", "ana"])).toEqual([
      { text: "Juan", match: true },
      { text: " ", match: false },
      { text: "Juana", match: true },
    ]);
  });

  it("la marca combinante queda resaltada con su letra", () => {
    expect(highlightSegments("José Luis", ["jose"])).toEqual([
      { text: "José", match: true },
      { text: " Luis", match: false },
    ]);
  });

  it("sin tokens o sin coincidencias devuelve el texto entero", () => {
    expect(highlightSegments("BRASIL", [])).toEqual([{ text: "BRASIL", match: false }]);
    expect(highlightSegments("BRASIL", ["xyz"])).toEqual([{ text: "BRASIL", match: false }]);
  });
});
