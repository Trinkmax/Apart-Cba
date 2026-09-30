import type { CatalogListing, StorefrontCatalog } from "@/lib/marketplace/contracts";

/**
 * Cuentas y selecciones de la home armadas desde el catálogo de la vidriera.
 * Todo puro (sin fetch): la página le pasa `getStorefrontCatalog()` y esto
 * decide qué mostrar. Nada inventado: si el catálogo viene vacío, cada
 * sección se oculta sola.
 */

export interface CatalogStats {
  /** Departamentos publicados. */
  units: number;
  /** Barrios con al menos un departamento. */
  hoods: number;
  /** Aceptan estadías cortas (pestaña "Por noche", la de /buscar por defecto). */
  shortStays: number;
  /** Barrios con al menos un departamento por noche. */
  shortHoods: number;
  /** Aceptan estadías por mes. */
  monthly: number;
}

export function catalogStats(catalog: Pick<StorefrontCatalog, "listings" | "hoods">): CatalogStats {
  const listings = catalog.listings ?? [];
  const short = listings.filter((l) => l.offers_short);
  return {
    units: listings.length,
    hoods: (catalog.hoods ?? []).filter((h) => h.count > 0).length,
    shortStays: short.length,
    shortHoods: new Set(short.map((l) => l.hood_slug).filter(Boolean)).size,
    monthly: listings.filter((l) => l.offers_monthly).length,
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "45 departamentos en 9 barrios" · "1 departamento en 1 barrio". */
export function unitsInHoodsLabel(units: number, hoods: number): string | null {
  if (!Number.isFinite(units) || units <= 0) return null;
  const u = `${units} ${plural(units, "departamento", "departamentos")}`;
  if (!Number.isFinite(hoods) || hoods <= 0) return u;
  return `${u} en ${hoods} ${plural(hoods, "barrio", "barrios")}`;
}

/** "1 depto" · "12 deptos". */
export function deptosLabel(n: number): string {
  return `${n} ${plural(n, "depto", "deptos")}`;
}

/**
 * Las unidades de "Lugares para quedarte": sólo las que aceptan estadías
 * cortas, variadas por barrio. Respeta el orden "recomendado" del catálogo
 * pero reparte por rondas (la mejor de cada barrio, después la segunda…) con
 * un tope por barrio, para que la grilla no sean ocho deptos de Nueva Córdoba.
 */
export function pickFeaturedListings(
  listings: CatalogListing[],
  opts: { limit?: number; perHood?: number } = {},
): CatalogListing[] {
  const limit = Math.max(0, opts.limit ?? 8);
  const perHood = Math.max(1, opts.perHood ?? 3);
  if (limit === 0) return [];

  const groups = new Map<string, CatalogListing[]>();
  for (const l of listings) {
    if (!l.offers_short) continue;
    const key = l.hood_slug ?? "sin-barrio";
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }

  const picked: CatalogListing[] = [];
  const queues = [...groups.values()].map((g) => g.slice(0, perHood));
  for (let round = 0; picked.length < limit; round++) {
    let tookAny = false;
    for (const q of queues) {
      if (picked.length >= limit) break;
      const next = q[round];
      if (next) {
        picked.push(next);
        tookAny = true;
      }
    }
    if (!tookAny) break;
  }
  return picked;
}

export interface HoodTile {
  name: string;
  slug: string;
  count: number;
  /** Portada de una unidad real del barrio (null si ninguna tiene fotos). */
  cover: string | null;
  href: string;
}

/**
 * Tiles de "Elegí tu barrio": cada tile lleva a /buscar?barrio=… en la vista
 * por defecto ("Por noche"), así que cuenta LO MISMO que muestra ese destino:
 * las unidades del barrio que aceptan estadías cortas (igual que los chips de
 * barrio de /buscar). Barrios sin ninguna, afuera. De más a menos, con la
 * portada de una unidad real (la primera del orden recomendado con foto).
 */
export function hoodTiles(
  catalog: Pick<StorefrontCatalog, "listings" | "hoods">,
  opts: { limit?: number } = {},
): HoodTile[] {
  const limit = Math.max(0, opts.limit ?? 8);
  const names = new Map((catalog.hoods ?? []).map((h) => [h.slug, h.name]));
  const tiles = new Map<string, HoodTile>();
  for (const l of catalog.listings ?? []) {
    if (!l.offers_short || !l.hood_slug) continue;
    const cover = l.cover_url ?? l.photo_urls?.[0] ?? null;
    const tile = tiles.get(l.hood_slug);
    if (tile) {
      tile.count += 1;
      if (!tile.cover && cover) tile.cover = cover;
      continue;
    }
    tiles.set(l.hood_slug, {
      name: names.get(l.hood_slug) ?? l.hood ?? l.hood_slug,
      slug: l.hood_slug,
      count: 1,
      cover,
      href: `/buscar?barrio=${encodeURIComponent(l.hood_slug)}`,
    });
  }
  return [...tiles.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"))
    .slice(0, limit);
}
