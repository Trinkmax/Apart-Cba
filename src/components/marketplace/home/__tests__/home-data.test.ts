import { describe, expect, it } from "vitest";
import {
  catalogStats,
  deptosLabel,
  hoodTiles,
  pickFeaturedListings,
  unitsInHoodsLabel,
} from "@/components/marketplace/home/home-data";
import type { CatalogListing } from "@/lib/marketplace/contracts";

function listing(id: string, hood: string | null, over: Partial<CatalogListing> = {}): CatalogListing {
  const slug = hood ? hood.toLowerCase().replace(/\s+/g, "-") : null;
  return {
    id,
    organization_id: "org",
    slug: id,
    marketplace_title: id.toUpperCase(),
    marketplace_property_type: "apartamento",
    neighborhood: hood,
    city: "Córdoba",
    address: null,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 2,
    size_m2: null,
    latitude: null,
    longitude: null,
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
    cover_url: `https://x.supabase.co/storage/v1/object/public/unit-photos/${id}.jpg`,
    photo_urls: [],
    amenities: [],
    display_title: id,
    display_tagline: null,
    hood,
    hood_slug: slug,
    summary_line: `Depto en ${hood}`,
    offers_short: true,
    offers_monthly: false,
    ...over,
  };
}

describe("pickFeaturedListings", () => {
  it("reparte por barrio en rondas, con tope por barrio y respetando el orden", () => {
    const list = [
      listing("nc1", "Nueva Cordoba"),
      listing("nc2", "Nueva Cordoba"),
      listing("nc3", "Nueva Cordoba"),
      listing("nc4", "Nueva Cordoba"),
      listing("c1", "Centro"),
      listing("gp1", "General Paz"),
      listing("c2", "Centro"),
    ];
    const ids = pickFeaturedListings(list, { limit: 8, perHood: 3 }).map((l) => l.id);
    expect(ids).toEqual(["nc1", "c1", "gp1", "nc2", "c2", "nc3"]);
  });

  it("deja afuera las unidades que no aceptan estadías cortas", () => {
    const list = [listing("m1", "Centro", { offers_short: false }), listing("t1", "Centro")];
    expect(pickFeaturedListings(list).map((l) => l.id)).toEqual(["t1"]);
  });

  it("corta en el límite", () => {
    const list = ["a", "b", "c", "d"].map((h) => listing(h, h));
    expect(pickFeaturedListings(list, { limit: 2 })).toHaveLength(2);
    expect(pickFeaturedListings(list, { limit: 0 })).toEqual([]);
  });
});

describe("hoodTiles", () => {
  it("cuenta lo que muestra /buscar por noche: sólo estadías cortas, de más a menos, con portada real", () => {
    const listings = [
      listing("c1", "Centro", { cover_url: null, photo_urls: [] }),
      listing("c2", "Centro"),
      listing("nc1", "Nueva Cordoba"),
      // Sólo por mes: no suma (en /buscar por noche no aparece).
      listing("nc2", "Nueva Cordoba", { offers_short: false, offers_monthly: true }),
      listing("nc3", "Nueva Cordoba", { offers_short: false, offers_monthly: true }),
      listing("co1", "Cofico", { offers_short: false, offers_monthly: true }),
    ];
    const tiles = hoodTiles({
      listings,
      hoods: [
        { name: "Centro", slug: "centro", count: 2 },
        { name: "Nueva Córdoba", slug: "nueva-cordoba", count: 3 },
        { name: "Cofico", slug: "cofico", count: 1 },
      ],
    });
    expect(tiles.map((t) => [t.slug, t.count])).toEqual([
      ["centro", 2],
      ["nueva-cordoba", 1],
    ]);
    expect(tiles[0].cover).toContain("c2.jpg");
    expect(tiles[1].name).toBe("Nueva Córdoba");
    expect(tiles[1].href).toBe("/buscar?barrio=nueva-cordoba");
  });
});

describe("cuentas y etiquetas", () => {
  it("catalogStats cuenta lo publicado", () => {
    const stats = catalogStats({
      listings: [
        listing("a", "Centro"),
        listing("b", "Centro", { offers_short: false, offers_monthly: true }),
        listing("c", "Alberdi", { offers_short: false, offers_monthly: true }),
      ],
      hoods: [
        { name: "Centro", slug: "centro", count: 2 },
        { name: "Alberdi", slug: "alberdi", count: 1 },
      ],
    });
    expect(stats).toEqual({ units: 3, hoods: 2, shortStays: 1, shortHoods: 1, monthly: 2 });
  });

  it("singular y plural en español", () => {
    expect(unitsInHoodsLabel(45, 9)).toBe("45 departamentos en 9 barrios");
    expect(unitsInHoodsLabel(1, 1)).toBe("1 departamento en 1 barrio");
    expect(unitsInHoodsLabel(0, 3)).toBeNull();
    expect(deptosLabel(1)).toBe("1 depto");
    expect(deptosLabel(12)).toBe("12 deptos");
  });
});
