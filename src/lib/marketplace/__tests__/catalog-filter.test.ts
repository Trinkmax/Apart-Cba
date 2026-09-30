import { describe, expect, it } from "vitest";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import type { UnitPricingRule } from "@/lib/types/database";
import {
  activeFilterCount,
  addMonthsIso,
  cardPrice,
  EMPTY_SEARCH,
  effectiveView,
  filterCatalog,
  hoodCounts,
  isIsoDate,
  listingHref,
  parseSearchState,
  rangeLabel,
  searchRange,
  searchStateToParams,
  shortDateLabel,
  sortListings,
  stayLabel,
  type SearchState,
} from "@/lib/marketplace/catalog-filter";

function unit(over: Partial<CatalogListing> & { id: string }): CatalogListing {
  return {
    organization_id: "org",
    slug: over.id,
    marketplace_title: over.id,
    marketplace_property_type: "departamento",
    neighborhood: "Nueva Córdoba",
    city: "Córdoba",
    address: null,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 2,
    size_m2: null,
    latitude: -31.42,
    longitude: -64.19,
    base_price: 70000,
    monthly_price: null,
    marketplace_currency: "ARS",
    cleaning_fee: null,
    instant_book: false,
    default_mode: "temporario",
    min_nights: 2,
    max_nights: null,
    rating_avg: 0,
    rating_count: 0,
    cover_url: null,
    photo_urls: [],
    amenities: [],
    display_title: over.id,
    display_tagline: null,
    hood: "Nueva Córdoba",
    hood_slug: "nueva-cordoba",
    summary_line: "Depto de 1 dormitorio en Nueva Córdoba",
    offers_short: true,
    offers_monthly: false,
    ...over,
  };
}

const state = (over: Partial<SearchState>): SearchState => ({ ...EMPTY_SEARCH, ...over });
const ids = (ls: CatalogListing[]) => ls.map((l) => l.id);
const q = (s: string) => parseSearchState(new URLSearchParams(s));

const corta = unit({ id: "corta", base_price: 60000, min_nights: 2 });
const larga = unit({ id: "larga", base_price: 90000, min_nights: 5, max_nights: 20, bedrooms: 2, max_guests: 4 });
const mono = unit({ id: "mono", bedrooms: 0, max_guests: 2, hood: "Centro", hood_slug: "centro", instant_book: true });
const tres = unit({ id: "tres", bedrooms: 3, max_guests: 5, base_price: 110000, default_mode: "mixto", offers_monthly: true, monthly_price: 900000 });
const mensual = unit({
  id: "mensual", default_mode: "mensual", offers_short: false, offers_monthly: true, monthly_price: 1050000, min_nights: 30,
});
const mixtoSinMes = unit({ id: "mixto", default_mode: "mixto", offers_monthly: true, monthly_price: null, base_price: 65000 });
const ALL = [corta, larga, mono, tres, mensual, mixtoSinMes];

describe("fechas", () => {
  it("valida ISO reales", () => {
    expect(isIsoDate("2026-10-03")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("3/10/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it("suma meses calendario y recorta a fin de mes", () => {
    expect(addMonthsIso("2026-10-03", 2)).toBe("2026-12-03");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("etiquetas es-AR", () => {
    expect(shortDateLabel("2026-10-03", { weekday: true })).toBe("sáb 3 oct");
    expect(rangeLabel("2026-10-03", "2026-10-06")).toBe("3–6 oct");
    expect(rangeLabel("2026-09-30", "2026-10-02")).toBe("30 sep – 2 oct");
    expect(stayLabel(state({ checkIn: "2026-10-03", checkOut: "2026-10-06", guests: 2 }))).toEqual({
      dates: "3–6 oct",
      guests: "2 huéspedes",
    });
    expect(stayLabel(state({ mode: "mes", checkIn: "2026-10-03", months: 2 })).dates).toBe("Desde 3 oct · 2 meses");
  });
});

describe("URL (SPEC 20 · D8)", () => {
  it("lee y escribe ida y vuelta", () => {
    const s = q("checkin=2026-10-03&checkout=2026-10-06&huespedes=2&barrio=nueva-cordoba&dormitorios=0&precio_max=80.000&inmediata=1&orden=precio_asc");
    expect(s).toMatchObject({
      mode: "noche", checkIn: "2026-10-03", checkOut: "2026-10-06", guests: 2, hood: "nueva-cordoba",
      bedrooms: 0, priceMax: 80000, instant: true, sort: "precio_asc",
    });
    expect(searchStateToParams(s).toString()).toBe(
      "checkin=2026-10-03&checkout=2026-10-06&huespedes=2&barrio=nueva-cordoba&dormitorios=0&precio_max=80000&inmediata=1&orden=precio_asc",
    );
  });
  it("ignora lo inválido", () => {
    const s = q("checkin=2026-13-01&checkout=ayer&huespedes=-1&barrio=<script>&dormitorios=9&orden=raro");
    expect(s).toEqual(EMPTY_SEARCH);
    expect(q("checkin=2026-10-06&checkout=2026-10-03").checkOut).toBeNull();
  });
  it("modo mes: acepta el legacy 'mensual' y deriva meses", () => {
    expect(q("modo=mensual").mode).toBe("mes");
    expect(q("modo=mes&checkin=2026-10-01&meses=3")).toMatchObject({ months: 3, checkOut: null });
    expect(q("modo=mes&checkin=2026-10-01").months).toBe(1);
    expect(q("modo=mes&checkin=2026-10-01&checkout=2026-12-01").months).toBe(2);
    expect(searchStateToParams(q("modo=mes&checkin=2026-10-01&meses=3")).toString()).toBe(
      "modo=mes&checkin=2026-10-01&meses=3",
    );
    expect(searchRange(q("modo=mes&checkin=2026-10-01&meses=1"))).toEqual({
      checkIn: "2026-10-01", checkOut: "2026-11-01", nights: 31,
    });
  });
});

describe("pestañas y cambio a mes", () => {
  it("noche muestra las que aceptan estadías cortas; mes, las mensuales", () => {
    expect(ids(filterCatalog(ALL, state({})))).toEqual(["corta", "larga", "mono", "tres", "mixto"]);
    expect(ids(filterCatalog(ALL, state({ mode: "mes" })))).toEqual(["tres", "mensual", "mixto"]);
  });
  it("28+ noches pasa a vista mes con aviso", () => {
    expect(effectiveView(state({ checkIn: "2026-10-01", checkOut: "2026-10-28" }))).toEqual({ view: "noche", autoMonthly: false });
    expect(effectiveView(state({ checkIn: "2026-10-01", checkOut: "2026-10-29" }))).toEqual({ view: "mes", autoMonthly: true });
    expect(ids(filterCatalog(ALL, state({ checkIn: "2026-10-01", checkOut: "2026-10-29" })))).toEqual(["tres", "mensual", "mixto"]);
  });
});

describe("filtros", () => {
  it("noches vs mínimo y máximo de la unidad", () => {
    const tresNoches = state({ checkIn: "2026-10-03", checkOut: "2026-10-06" });
    expect(ids(filterCatalog(ALL, tresNoches))).toEqual(["corta", "mono", "tres", "mixto"]);
    const veinticinco = state({ checkIn: "2026-10-01", checkOut: "2026-10-26" });
    expect(ids(filterCatalog(ALL, veinticinco))).not.toContain("larga");
    expect(ids(filterCatalog(ALL, state({ checkIn: "2026-10-01", checkOut: "2026-10-08" })))).toContain("larga");
  });
  it("una regla de precio con mínimo en ALGUNA noche del rango también filtra (igual que la ficha y el checkout)", () => {
    // Finde largo 10–12/10 con mínimo 3 sobre una unidad de mínimo 2.
    const finde: UnitPricingRule = {
      id: "finde-largo", unit_id: "finde", organization_id: "org", name: "Finde largo",
      rule_type: "date_range", start_date: "2026-10-10", end_date: "2026-10-12", days_of_week: null,
      price_multiplier: 1.2, price_override: null, min_nights_override: 3, priority: 1, active: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    const conFinde = unit({ id: "finde", min_nights: 2, pricing_rules: [finde] });
    // 9→11: la llegada no tiene regla, pero la noche del 10 sí → mínimo 3, 2 noches no alcanzan.
    expect(filterCatalog([conFinde], state({ checkIn: "2026-10-09", checkOut: "2026-10-11" }))).toEqual([]);
    expect(ids(filterCatalog([conFinde], state({ checkIn: "2026-10-08", checkOut: "2026-10-11" })))).toEqual(["finde"]);
    // Fuera del finde rige el mínimo de la unidad; sin fechas no se filtra por noches.
    expect(ids(filterCatalog([conFinde], state({ checkIn: "2026-10-05", checkOut: "2026-10-07" })))).toEqual(["finde"]);
    expect(ids(filterCatalog([conFinde], state({})))).toEqual(["finde"]);
    // Una regla inactiva no cuenta.
    const inactiva = unit({ id: "finde", min_nights: 2, pricing_rules: [{ ...finde, active: false }] });
    expect(ids(filterCatalog([inactiva], state({ checkIn: "2026-10-09", checkOut: "2026-10-11" })))).toEqual(["finde"]);
  });
  it("huéspedes: capacidad mayor o igual", () => {
    expect(ids(filterCatalog(ALL, state({ guests: 4 })))).toEqual(["larga", "tres"]);
    expect(ids(filterCatalog(ALL, state({ guests: 6 })))).toEqual([]);
  });
  it("dormitorios: monoambiente = 0 y 3 = tres o más", () => {
    expect(ids(filterCatalog(ALL, state({ bedrooms: 0 })))).toEqual(["mono"]);
    expect(ids(filterCatalog(ALL, state({ bedrooms: 2 })))).toEqual(["larga"]);
    expect(ids(filterCatalog(ALL, state({ bedrooms: 3 })))).toEqual(["tres"]);
    const sinDato = unit({ id: "sin", bedrooms: null });
    expect(filterCatalog([sinDato], state({ bedrooms: 1 }))).toEqual([]);
  });
  it("precio máximo según la pestaña (a consultar queda afuera)", () => {
    expect(ids(filterCatalog(ALL, state({ priceMax: 70000 })))).toEqual(["corta", "mono", "mixto"]);
    expect(ids(filterCatalog(ALL, state({ mode: "mes", priceMax: 1000000 })))).toEqual(["tres"]);
  });
  it("barrio e inmediata", () => {
    expect(ids(filterCatalog(ALL, state({ hood: "centro" })))).toEqual(["mono"]);
    expect(ids(filterCatalog(ALL, state({ instant: true })))).toEqual(["mono"]);
    // En vista mes la reserva inmediata no aplica (se consulta).
    expect(ids(filterCatalog(ALL, state({ mode: "mes", instant: true })))).toEqual(["tres", "mensual", "mixto"]);
  });
  it("disponibilidad: sólo con rango completo", () => {
    const busy = new Set(["corta"]);
    expect(ids(filterCatalog(ALL, state({}), { unavailable: busy }))).toContain("corta");
    const conFechas = state({ checkIn: "2026-10-03", checkOut: "2026-10-06" });
    expect(ids(filterCatalog(ALL, conFechas, { unavailable: busy }))).not.toContain("corta");
  });
  it("cuenta por barrio con los demás filtros y los filtros activos", () => {
    const counts = hoodCounts(ALL, state({ hood: "centro", guests: 2 }));
    expect(counts.get("nueva-cordoba")).toBe(4);
    expect(counts.get("centro")).toBe(1);
    expect(activeFilterCount(state({ bedrooms: 0, priceMax: 5, instant: true }))).toBe(3);
    expect(activeFilterCount(state({ mode: "mes", instant: true }))).toBe(0);
  });
});

describe("orden y precio de la tarjeta", () => {
  it("recomendado respeta el catálogo; precio con 'a consultar' al final", () => {
    expect(ids(sortListings(ALL, state({})))).toEqual(ids(ALL));
    const asc = ids(sortListings(filterCatalog(ALL, state({ mode: "mes" })), state({ mode: "mes", sort: "precio_asc" })));
    expect(asc).toEqual(["tres", "mensual", "mixto"]);
    const desc = ids(sortListings(filterCatalog(ALL, state({})), state({ sort: "precio_desc" })));
    expect(desc).toEqual(["tres", "larga", "corta", "mono", "mixto"].sort((a, b) => {
      const p = (id: string) => ALL.find((l) => l.id === id)!.base_price;
      return p(b) - p(a) || ids(ALL).indexOf(a) - ids(ALL).indexOf(b);
    }));
  });
  it("con fechas muestra el total; sin fechas, el titular de la pestaña", () => {
    const stay = { checkIn: "2026-10-03", checkOut: "2026-10-06" };
    expect(cardPrice(corta, "noche", stay)).toEqual({ kind: "total", total: 180000, nights: 3, nightly: 60000, currency: "ARS" });
    expect(cardPrice(unit({ id: "x", cleaning_fee: 15000 }), "noche", stay)).toMatchObject({ total: 225000 });
    expect(cardPrice(corta, "noche")).toEqual({ kind: "amount", amount: 60000, per: "noche", currency: "ARS" });
    expect(cardPrice(mensual, "noche", stay)).toEqual({ kind: "amount", amount: 1050000, per: "mes", currency: "ARS" });
    expect(cardPrice(mixtoSinMes, "mes")).toEqual({ kind: "consult" });
    expect(cardPrice(corta, "noche", { checkIn: "2026-10-01", checkOut: "2026-11-01" }).kind).toBe("amount");
  });
  it("link a la ficha con las fechas", () => {
    expect(listingHref("parana")).toBe("/u/parana");
    expect(listingHref("parana", { checkIn: "2026-10-03", checkOut: "2026-10-06", guests: 2 })).toBe(
      "/u/parana?checkin=2026-10-03&checkout=2026-10-06&huespedes=2",
    );
    expect(listingHref("parana", { checkIn: "2026-10-06", checkOut: "2026-10-03" })).toBe("/u/parana");
  });
});
