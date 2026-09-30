import { unitMonthlyPrice } from "@/lib/units/pricing";
import type { MarketplaceListingSummary, UnitDefaultMode } from "@/lib/types/database";
import type { CatalogListing, StorefrontCatalog } from "./contracts";
import {
  canonicalNeighborhood,
  displayTitle,
  listingSummaryLine,
  neighborhoodSlug,
} from "./display";
import { offersMonthlyStays, offersShortStays } from "./stay";

/**
 * Armado PURO del catálogo de la vidriera: sin base, sin caché, sin sesión.
 * `storefront.ts` trae las filas y delega acá todo lo que es forma y orden,
 * así el criterio de "recomendados", los barrios y los campos de display
 * quedan cubiertos por tests (`__tests__/catalog.test.ts`).
 */

/** Imágenes por unidad que viajan en el catálogo (carrusel de las tarjetas). */
export const CATALOG_PHOTOS_PER_UNIT = 6;

// ─── Fila de `units` → resumen ───────────────────────────────────────────────

/**
 * Columnas de `units` que necesita `rowToSummary`. Incluye `monthly_price`:
 * sin él, `unitMonthlyPrice()` devuelve null y la web mostraría "a consultar"
 * en unidades que sí tienen renta de lista.
 */
export const UNIT_SUMMARY_COLUMNS =
  "id, organization_id, slug, marketplace_title, name, marketplace_property_type, neighborhood, city, bedrooms, bathrooms, max_guests, size_m2, latitude, longitude, base_price, monthly_price, marketplace_currency, cleaning_fee, instant_book, default_mode, marketplace_rating_avg, marketplace_rating_count, cover_image_url, min_nights, max_nights";

export type UnitRow = {
  id: string;
  organization_id: string;
  slug: string | null;
  marketplace_title: string | null;
  name: string;
  marketplace_property_type: string | null;
  neighborhood: string | null;
  city: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_guests: number | null;
  size_m2: number | null;
  latitude: number | null;
  longitude: number | null;
  base_price: number | null;
  /** units.monthly_price (mig 063/066). Opcional: sólo si el select lo trae. */
  monthly_price?: number | string | null;
  marketplace_currency: string | null;
  cleaning_fee: number | null;
  instant_book: boolean;
  default_mode: UnitDefaultMode | null;
  marketplace_rating_avg: number | null;
  marketplace_rating_count: number | null;
  cover_image_url: string | null;
  marketplace_description?: string | null;
  house_rules?: string | null;
  cancellation_policy?: string | null;
  min_nights: number;
  max_nights: number | null;
  check_in_window_start?: string | null;
  check_in_window_end?: string | null;
  organization?: { id: string; name: string; logo_url: string | null } | null;
};

/** Fila de `units` (+ fotos y amenities ya resueltas) → resumen de la web. */
export function rowToSummary(
  row: UnitRow,
  photoUrls: string[],
  amenities: string[],
): MarketplaceListingSummary {
  return {
    id: row.id,
    organization_id: row.organization_id,
    slug: row.slug ?? row.id,
    marketplace_title: row.marketplace_title ?? row.name,
    marketplace_property_type: row.marketplace_property_type ?? "apartamento",
    neighborhood: row.neighborhood,
    city: row.city ?? null,
    // La dirección exacta no viaja en lo público (catálogo, fichas estáticas):
    // se comparte en la página de seguimiento recién con la reserva confirmada.
    address: null,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    max_guests: row.max_guests,
    size_m2: row.size_m2 ? Number(row.size_m2) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    base_price: Number(row.base_price ?? 0),
    monthly_price: unitMonthlyPrice(row),
    marketplace_currency: row.marketplace_currency ?? "ARS",
    cleaning_fee: row.cleaning_fee != null ? Number(row.cleaning_fee) : null,
    instant_book: row.instant_book,
    default_mode: row.default_mode ?? "temporario",
    min_nights: row.min_nights ?? 1,
    max_nights: row.max_nights ?? null,
    rating_avg: Number(row.marketplace_rating_avg ?? 0),
    rating_count: row.marketplace_rating_count ?? 0,
    cover_url: photoUrls[0] ?? row.cover_image_url,
    photo_urls: photoUrls,
    amenities,
  };
}

/** Campos de display que la web agrega a cada unidad (catálogo y ficha). */
export type DisplayFields = Pick<
  CatalogListing,
  | "display_title"
  | "display_tagline"
  | "hood"
  | "hood_slug"
  | "summary_line"
  | "offers_short"
  | "offers_monthly"
>;

type DisplaySource = Pick<
  MarketplaceListingSummary,
  "marketplace_title" | "neighborhood" | "bedrooms" | "default_mode" | "min_nights"
>;

/**
 * Nombre, barrio y pestañas de una unidad tal como se muestran en la web.
 * El título sale de `marketplace_title` (que ya cae a `name`): es donde el
 * equipo escribe "PARANA -Nueva Córdoba " o "DIVA -Complejo-".
 */
export function displayFieldsFor(unit: DisplaySource): DisplayFields {
  const { title, tagline } = displayTitle(unit.marketplace_title);
  return {
    display_title: title,
    display_tagline: tagline,
    hood: canonicalNeighborhood(unit.neighborhood),
    hood_slug: neighborhoodSlug(unit.neighborhood),
    summary_line: listingSummaryLine({
      bedrooms: unit.bedrooms,
      neighborhood: unit.neighborhood,
    }),
    offers_short: offersShortStays(unit),
    offers_monthly: offersMonthlyStays(unit),
  };
}

/** El resumen (o el detalle) con sus campos de display. */
export function withDisplayFields<T extends MarketplaceListingSummary>(
  summary: T,
): T & DisplayFields {
  return { ...summary, ...displayFieldsFor(summary) };
}

// ─── Fotos ───────────────────────────────────────────────────────────────────

export interface PhotoRow {
  unit_id: string;
  public_url: string | null;
  is_cover?: boolean | null;
  sort_order?: number | null;
}

export interface UnitPhotoSet {
  /** Portada primero, después por `sort_order`; hasta `limit`. */
  urls: string[];
  /** Total de imágenes publicadas de la unidad (ordena "recomendados"). */
  count: number;
}

/**
 * Agrupa las imágenes por unidad. Ordena acá (portada primero, después
 * `sort_order`) para no depender del orden en que llegaron las filas: una
 * lectura paginada o un índice distinto no pueden cambiar la portada.
 */
export function groupPhotosByUnit(
  rows: PhotoRow[],
  limit: number = CATALOG_PHOTOS_PER_UNIT,
): Map<string, UnitPhotoSet> {
  const sorted = rows
    .filter((r) => Boolean(r.public_url))
    .map((r, index) => ({ r, index }))
    .sort((a, b) => {
      const cover = Number(Boolean(b.r.is_cover)) - Number(Boolean(a.r.is_cover));
      if (cover !== 0) return cover;
      const order = (a.r.sort_order ?? 0) - (b.r.sort_order ?? 0);
      return order !== 0 ? order : a.index - b.index;
    });

  const byUnit = new Map<string, UnitPhotoSet>();
  for (const { r } of sorted) {
    const entry = byUnit.get(r.unit_id) ?? { urls: [], count: 0 };
    entry.count += 1;
    if (entry.urls.length < limit) entry.urls.push(r.public_url as string);
    byUnit.set(r.unit_id, entry);
  }
  return byUnit;
}

/** Códigos de amenities agrupados por unidad (sin duplicados). */
export function groupAmenitiesByUnit(
  rows: { unit_id: string; amenity_code: string | null }[],
): Map<string, string[]> {
  const byUnit = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.amenity_code) continue;
    const arr = byUnit.get(r.unit_id) ?? [];
    if (!arr.includes(r.amenity_code)) arr.push(r.amenity_code);
    byUnit.set(r.unit_id, arr);
  }
  return byUnit;
}

// ─── Orden y barrios ─────────────────────────────────────────────────────────

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export interface RecommendedKey {
  id: string;
  offers_short: boolean;
  display_title: string;
  /** Total de imágenes publicadas (no sólo las que viajan en el catálogo). */
  image_count: number;
}

/**
 * Orden "recomendado" de la vidriera: primero las que aceptan estadías cortas
 * (la pestaña por defecto del sitio), dentro de cada grupo las que tienen más
 * fotos, y a igualdad por nombre (`display_title`, orden español con números
 * naturales: "Caseros 2" antes que "Caseros 10"). El id cierra cualquier
 * empate para que el orden sea estable entre builds.
 */
export function compareRecommended(a: RecommendedKey, b: RecommendedKey): number {
  if (a.offers_short !== b.offers_short) return a.offers_short ? -1 : 1;
  if (a.image_count !== b.image_count) return b.image_count - a.image_count;
  const byTitle = collator.compare(a.display_title, b.display_title);
  if (byTitle !== 0) return byTitle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Barrios con unidades publicadas, de más a menos (a igualdad, alfabético).
 * Agrupa por slug: "NUEVA CORDBA" y "Nueva Córdoba" son el mismo barrio.
 */
export function aggregateHoods(
  listings: Pick<CatalogListing, "hood" | "hood_slug">[],
): StorefrontCatalog["hoods"] {
  const bySlug = new Map<string, { name: string; slug: string; count: number }>();
  for (const l of listings) {
    if (!l.hood || !l.hood_slug) continue;
    const entry = bySlug.get(l.hood_slug);
    if (entry) entry.count += 1;
    else bySlug.set(l.hood_slug, { name: l.hood, slug: l.hood_slug, count: 1 });
  }
  return Array.from(bySlug.values()).sort(
    (a, b) => b.count - a.count || collator.compare(a.name, b.name),
  );
}

/**
 * Catálogo completo a partir de los resúmenes ya armados: agrega los campos
 * de display, ordena por "recomendado" y cuenta barrios.
 * `imageCounts` = total de imágenes por unidad (sin el tope de 6).
 */
export function assembleCatalog(params: {
  summaries: MarketplaceListingSummary[];
  imageCounts: Map<string, number>;
  generatedAt: string;
}): StorefrontCatalog {
  const listings: CatalogListing[] = params.summaries.map((s) => withDisplayFields(s));
  const count = (id: string) => params.imageCounts.get(id) ?? 0;
  listings.sort((a, b) =>
    compareRecommended(
      { id: a.id, offers_short: a.offers_short, display_title: a.display_title, image_count: count(a.id) },
      { id: b.id, offers_short: b.offers_short, display_title: b.display_title, image_count: count(b.id) },
    ),
  );
  return {
    listings,
    hoods: aggregateHoods(listings),
    generated_at: params.generatedAt,
  };
}

// ─── Fechas de búsqueda ──────────────────────────────────────────────────────

/**
 * Tope de noches de una búsqueda por fechas. 366 y no 365: una búsqueda "por 12
 * meses" que cruza un 29 de febrero tiene 366 noches y no puede fallar.
 */
export const SEARCH_MAX_NIGHTS = 366;

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha real con forma YYYY-MM-DD? ("2026-02-30" no lo es.) */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Noches entre dos fechas ISO (salida exclusiva), en UTC para no sufrir DST. */
export function nightsBetweenIso(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Suma meses a una fecha ISO. Si el día no existe en el mes de destino se
 * corre al siguiente (29/02 + 12 meses = 01/03), como hace `Date.UTC`.
 */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

export type StayRangeCheck =
  | { ok: true; checkIn: string; checkOut: string; nights: number }
  | { ok: false; error: string };

/**
 * Valida las fechas de una búsqueda: formato, llegada desde hoy (en horario
 * de Argentina, lo pasa quien llama), salida después de la llegada y un tope
 * de noches. Los mensajes son para el huésped.
 */
export function validateStayRange(
  input: { checkIn: unknown; checkOut: unknown },
  todayIso: string,
): StayRangeCheck {
  const { checkIn, checkOut } = input;
  if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) {
    return { ok: false, error: "Elegí fechas válidas de llegada y salida." };
  }
  if (checkIn < todayIso) {
    return { ok: false, error: "La fecha de llegada ya pasó. Elegí otra." };
  }
  if (checkOut <= checkIn) {
    return { ok: false, error: "La salida tiene que ser después de la llegada." };
  }
  const nights = nightsBetweenIso(checkIn, checkOut);
  if (nights > SEARCH_MAX_NIGHTS) {
    return { ok: false, error: `Podés buscar hasta ${SEARCH_MAX_NIGHTS} noches.` };
  }
  return { ok: true, checkIn, checkOut, nights };
}
