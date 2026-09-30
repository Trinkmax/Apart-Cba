import { describe, expect, it } from "vitest";
import { readLastSearch, rememberLastSearch, searchHrefFromListingQuery } from "../last-search";

describe("searchHrefFromListingQuery", () => {
  it("lleva a /buscar sólo las fechas y los huéspedes de la ficha", () => {
    expect(searchHrefFromListingQuery("?checkin=2026-10-03&checkout=2026-10-06&huespedes=2&error=x")).toBe(
      "/buscar?checkin=2026-10-03&checkout=2026-10-06&huespedes=2",
    );
  });
  it("sin nada, /buscar a secas", () => {
    expect(searchHrefFromListingQuery("")).toBe("/buscar");
    expect(searchHrefFromListingQuery("?utm_source=ig")).toBe("/buscar");
  });
});

describe("sin storage (server o navegación privada)", () => {
  it("no rompe: no guarda nada y no devuelve nada", () => {
    expect(() => rememberLastSearch("/buscar?barrio=centro")).not.toThrow();
    expect(readLastSearch()).toBeNull();
  });
});
