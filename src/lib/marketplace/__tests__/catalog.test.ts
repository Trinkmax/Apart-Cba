import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  aggregateHoods,
  assembleCatalog,
  compareRecommended,
  displayFieldsFor,
  groupAmenitiesByUnit,
  groupPhotosByUnit,
  isIsoDay,
  nightsBetweenIso,
  rowToSummary,
  validateStayRange,
  type UnitRow,
} from "@/lib/marketplace/catalog";
import type { MarketplaceListingSummary } from "@/lib/types/database";

function summary(over: Partial<MarketplaceListingSummary> & { id: string }): MarketplaceListingSummary {
  return {
    organization_id: "org-1",
    slug: over.id,
    marketplace_title: "DEPTO",
    marketplace_property_type: "apartamento",
    neighborhood: "NUEVA CORDOBA",
    city: "Córdoba",
    address: null,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 2,
    size_m2: null,
    latitude: null,
    longitude: null,
    base_price: 50000,
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
    ...over,
  };
}

describe("displayFieldsFor", () => {
  it("separa el sufijo del PMS y normaliza el barrio", () => {
    const f = displayFieldsFor(
      summary({ id: "a", marketplace_title: "PARANA -Nueva Córdoba ", neighborhood: "NUEVA CORDBA", bedrooms: 2 }),
    );
    expect(f.display_title).toBe("Paraná");
    expect(f.display_tagline).toBeNull();
    expect(f.hood).toBe("Nueva Córdoba");
    expect(f.hood_slug).toBe("nueva-cordoba");
    expect(f.summary_line).toBe("Depto de 2 dormitorios en Nueva Córdoba");
  });

  it("conserva un sufijo que no es barrio como tagline", () => {
    const f = displayFieldsFor(summary({ id: "b", marketplace_title: "PERON 2 -Futura Pilay", neighborhood: "CRISOL" }));
    expect(f.display_title).toBe("Perón 2");
    expect(f.display_tagline).toBe("Futura Pilay");
    expect(f.hood).toBe("Crisol");
  });

  it("pestañas: temporaria con mínimo de 30 noches es, en los hechos, mensual", () => {
    const f = displayFieldsFor(summary({ id: "c", default_mode: "temporario", min_nights: 30 }));
    expect(f.offers_short).toBe(false);
    expect(f.offers_monthly).toBe(true);
    const mixto = displayFieldsFor(summary({ id: "d", default_mode: "mixto", min_nights: 2 }));
    expect(mixto.offers_short).toBe(true);
    expect(mixto.offers_monthly).toBe(true);
  });
});

describe("groupPhotosByUnit", () => {
  it("portada primero, después sort_order, con tope y conteo total", () => {
    const rows = [
      { unit_id: "u1", public_url: "u1-3", is_cover: false, sort_order: 3 },
      { unit_id: "u1", public_url: "u1-1", is_cover: false, sort_order: 1 },
      { unit_id: "u1", public_url: "u1-cover", is_cover: true, sort_order: 9 },
      { unit_id: "u1", public_url: "u1-2", is_cover: false, sort_order: 2 },
      { unit_id: "u2", public_url: null, is_cover: true, sort_order: 0 },
      { unit_id: "u2", public_url: "u2-a", is_cover: false, sort_order: 0 },
    ];
    const map = groupPhotosByUnit(rows, 3);
    expect(map.get("u1")).toEqual({ urls: ["u1-cover", "u1-1", "u1-2"], count: 4 });
    // Una fila sin URL no cuenta ni ocupa la portada.
    expect(map.get("u2")).toEqual({ urls: ["u2-a"], count: 1 });
  });

  it("amenities agrupadas sin duplicados", () => {
    const map = groupAmenitiesByUnit([
      { unit_id: "u1", amenity_code: "wifi" },
      { unit_id: "u1", amenity_code: "wifi" },
      { unit_id: "u1", amenity_code: "ac" },
      { unit_id: "u2", amenity_code: null },
    ]);
    expect(map.get("u1")).toEqual(["wifi", "ac"]);
    expect(map.has("u2")).toBe(false);
  });
});

describe("orden recomendado", () => {
  const key = (id: string, offers_short: boolean, image_count: number, display_title: string) => ({
    id,
    offers_short,
    image_count,
    display_title,
  });

  it("cortas primero, más fotos primero, después nombre (con números naturales) e id", () => {
    const items = [
      key("m1", false, 30, "Zeta"),
      key("s1", true, 5, "Caseros 10"),
      key("s2", true, 12, "Brasil"),
      key("s3", true, 5, "Caseros 2"),
      key("s4", true, 5, "caseros 2"),
    ];
    const ids = [...items].sort(compareRecommended).map((i) => i.id);
    expect(ids).toEqual(["s2", "s3", "s4", "s1", "m1"]);
  });

  it("es estable: el mismo conjunto en cualquier orden da el mismo resultado", () => {
    const items = [key("b", true, 3, "Roma"), key("a", true, 3, "Roma"), key("c", false, 0, "Alcorta")];
    const one = [...items].sort(compareRecommended).map((i) => i.id);
    const two = [...items].reverse().sort(compareRecommended).map((i) => i.id);
    expect(one).toEqual(["a", "b", "c"]);
    expect(two).toEqual(one);
  });
});

describe("aggregateHoods", () => {
  it("agrupa por slug, cuenta y ordena de más a menos (empate alfabético)", () => {
    const hoods = aggregateHoods([
      { hood: "Nueva Córdoba", hood_slug: "nueva-cordoba" },
      { hood: "Centro", hood_slug: "centro" },
      { hood: "Nueva Córdoba", hood_slug: "nueva-cordoba" },
      { hood: "Alberdi", hood_slug: "alberdi" },
      { hood: null, hood_slug: null },
    ]);
    expect(hoods).toEqual([
      { name: "Nueva Córdoba", slug: "nueva-cordoba", count: 2 },
      { name: "Alberdi", slug: "alberdi", count: 1 },
      { name: "Centro", slug: "centro", count: 1 },
    ]);
  });
});

describe("assembleCatalog", () => {
  it("agrega display, ordena y cuenta barrios", () => {
    const catalog = assembleCatalog({
      summaries: [
        summary({ id: "mensual", marketplace_title: "INDEPENDENCIA 1446", default_mode: "mensual", min_nights: 30 }),
        summary({ id: "pocas", marketplace_title: "ROMA - General Paz", neighborhood: "GENERAL PAZ" }),
        summary({ id: "muchas", marketplace_title: "BRASIL -Nueva Cordoba-" }),
      ],
      imageCounts: new Map([
        ["mensual", 40],
        ["pocas", 3],
        ["muchas", 22],
      ]),
      generatedAt: "2026-09-29T12:00:00.000Z",
    });
    expect(catalog.listings.map((l) => l.id)).toEqual(["muchas", "pocas", "mensual"]);
    expect(catalog.listings[1].display_title).toBe("Roma");
    expect(catalog.listings[1].hood).toBe("General Paz");
    expect(catalog.hoods).toEqual([
      { name: "Nueva Córdoba", slug: "nueva-cordoba", count: 2 },
      { name: "General Paz", slug: "general-paz", count: 1 },
    ]);
    expect(catalog.generated_at).toBe("2026-09-29T12:00:00.000Z");
  });
});

describe("fechas de búsqueda", () => {
  it("isIsoDay acepta sólo fechas reales YYYY-MM-DD", () => {
    expect(isIsoDay("2026-10-01")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-10-1")).toBe(false);
    expect(isIsoDay("01/10/2026")).toBe(false);
    expect(isIsoDay(null)).toBe(false);
    expect(isIsoDay(20261001)).toBe(false);
  });

  it("noches y meses en UTC", () => {
    expect(nightsBetweenIso("2026-10-01", "2026-10-05")).toBe(4);
    expect(nightsBetweenIso("2026-12-30", "2027-01-02")).toBe(3);
    expect(addMonthsIso("2026-09-29", 12)).toBe("2027-09-29");
    expect(addMonthsIso("2028-02-29", 12)).toBe("2029-03-01");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
  });

  const today = "2026-09-29";

  it("valida formato, llegada desde hoy, orden y tope de noches", () => {
    expect(validateStayRange({ checkIn: "2026-10-01", checkOut: "2026-10-04" }, today)).toEqual({
      ok: true,
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      nights: 3,
    });
    expect(validateStayRange({ checkIn: today, checkOut: "2026-09-30" }, today).ok).toBe(true);

    const bad = (checkIn: unknown, checkOut: unknown) => {
      const r = validateStayRange({ checkIn, checkOut }, today);
      return r.ok ? null : r.error;
    };
    expect(bad("2026-10-01", undefined)).toMatch(/fechas válidas/);
    expect(bad("2026-02-30", "2026-03-02")).toMatch(/fechas válidas/);
    expect(bad("2026-09-28", "2026-10-02")).toMatch(/ya pasó/);
    expect(bad("2026-10-05", "2026-10-05")).toMatch(/después de la llegada/);
    expect(bad("2026-10-05", "2026-10-01")).toMatch(/después de la llegada/);
    expect(bad("2026-10-01", "2027-10-03")).toMatch(/366 noches/);
    expect(bad("2026-10-01", "2027-10-01")).toBeNull();
    // 12 meses que cruzan un 29 de febrero = 366 noches: no puede fallar.
    expect(bad("2027-10-01", "2028-10-01")).toBeNull();
  });
});

describe("rowToSummary", () => {
  const row: UnitRow = {
    id: "u-1",
    organization_id: "org-1",
    slug: null,
    marketplace_title: null,
    name: "RONDEAU 2",
    marketplace_property_type: null,
    neighborhood: "Güemes",
    city: null,
    address: "Rondeau 123",
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 3,
    size_m2: null,
    latitude: -31.42,
    longitude: -64.19,
    base_price: 48000,
    monthly_price: "650000",
    marketplace_currency: null,
    cleaning_fee: null,
    instant_book: false,
    default_mode: "mixto",
    marketplace_rating_avg: null,
    marketplace_rating_count: null,
    cover_image_url: "https://x/cover.jpg",
    min_nights: 2,
    max_nights: null,
  };

  it("la renta mensual sale de monthly_price (nunca noche × 30) y sólo si la unidad es mensual", () => {
    expect(rowToSummary(row, [], []).monthly_price).toBe(650000);
    expect(rowToSummary({ ...row, default_mode: "temporario" }, [], []).monthly_price).toBeNull();
    expect(rowToSummary({ ...row, monthly_price: null }, [], []).monthly_price).toBeNull();
    expect(rowToSummary({ ...row, monthly_price: undefined }, [], []).monthly_price).toBeNull();
  });

  it("defaults: slug = id, título = nombre, portada = primera imagen o la de la unidad", () => {
    const s = rowToSummary(row, [], []);
    expect(s.slug).toBe("u-1");
    expect(s.marketplace_title).toBe("RONDEAU 2");
    expect(s.marketplace_currency).toBe("ARS");
    expect(s.cover_url).toBe("https://x/cover.jpg");
    expect(rowToSummary(row, ["https://x/a.jpg"], []).cover_url).toBe("https://x/a.jpg");
  });
});
