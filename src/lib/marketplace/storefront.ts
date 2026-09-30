import "server-only";

import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import type { PostgrestFilterBuilder } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  CancellationPolicy,
  MarketplaceListingDetail,
  UnitPhoto,
  UnitPricingRule,
} from "@/lib/types/database";
import {
  assembleCatalog,
  groupAmenitiesByUnit,
  groupPhotosByUnit,
  rowToSummary,
  UNIT_SUMMARY_COLUMNS,
  withDisplayFields,
  type UnitRow,
} from "./catalog";
import type { StorefrontCatalog, StorefrontListingDetail } from "./contracts";

/**
 * La vidriera: lo que la web pública puede mostrar y vender.
 *
 * Una unidad está en la vidriera si está publicada (`marketplace_published`),
 * activa, tiene slug y precio por noche, y es de una organización que vende en
 * la web (`organizations.marketplace_enabled` + `active`; hoy sólo Apart CBA).
 * Toda lectura pública pasa por acá — el mismo proyecto aloja organizaciones
 * demo con reseñas falsas que no pueden aparecer en www.apartcba.com.
 *
 * Caché: el catálogo completo (≈45 unidades) se arma una vez cada 5 minutos
 * con el tag `storefront-catalog`; las mutaciones del panel que cambian datos
 * públicos (fotos, precios, publicación) lo revalidan con `revalidateTag`.
 */
export const STOREFRONT_TAG = "storefront-catalog";

/**
 * Invalida el catálogo cacheado de la vidriera (y la lista de organizaciones).
 * Para las mutaciones del panel que cambian algo público: fotos, precios,
 * publicación, textos. Expira YA (`expire: 0`) en vez de "stale-while-
 * revalidate" ("max"): las mismas acciones revalidan `/` y `/buscar`, y con
 * "max" esas páginas se regenerarían con el catálogo viejo y lo servirían
 * otros 5 minutos. Sirve desde Server Actions y Route Handlers (`updateTag`
 * sólo desde acciones). Best-effort: nunca rompe la mutación.
 */
export function revalidateStorefront(): void {
  try {
    revalidateTag(STOREFRONT_TAG, { expire: 0 });
  } catch (err) {
    console.error("[storefront] no se pudo revalidar el catálogo", err);
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Tiene forma de UUID? (un id mal formado haría fallar la consulta con 22P02). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ─── Organizaciones de la vidriera ───────────────────────────────────────────

async function loadStorefrontOrgIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("marketplace_enabled", true)
    .eq("active", true)
    .order("created_at", { ascending: true });
  // Se lanza: devolver [] se cachearía como "la vidriera está vacía".
  if (error) throw new Error(`No se pudo leer la vidriera: ${error.message}`);
  return (data ?? []).map((o) => o.id as string);
}

/**
 * Organizaciones que venden en la web (cacheado 5 min, como el catálogo). El
 * tag `storefront-catalog` la invalida al instante cuando cambia algo; un
 * `revalidate` más corto sólo acortaba el ISR de `/u/[slug]` a 60 s (la página
 * hereda el menor `revalidate` de lo que lee).
 */
export const getStorefrontOrgIds = cache(async (): Promise<string[]> => {
  return unstable_cache(loadStorefrontOrgIds, ["storefront-org-ids"], {
    revalidate: 300,
    tags: [STOREFRONT_TAG],
  })();
});

/**
 * El query de `units` que devuelve `storefrontUnitsQuery`, con la fila sin
 * tipar: cada caller castea `data` a su forma (el cliente admin no lleva el
 * tipo de la base). El retorno va EXPLÍCITO a propósito: inferido, TypeScript
 * tenía que escribir en la declaración el tipo del `select` genérico de
 * supabase-js, y el chequeo incremental de `next build` —que calcula esas
 * declaraciones para los archivos cambiados cuando arranca de un
 * `.tsbuildinfo` viejo, como el que Vercel restaura en `.next/cache`— se
 * quedaba sin memoria (OOM local y `std::bad_alloc` en Vercel, 30/09/2026).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StorefrontUnitsQuery = PostgrestFilterBuilder<any, any, any, any, any, any, any>;

/**
 * `units` con el scope de la vidriera aplicado. Encadená los filtros propios
 * (`.eq("slug", …)`, `.in("id", …)`) sobre lo que devuelve.
 */
export function storefrontUnitsQuery(admin: AdminClient, orgIds: string[], columns: string): StorefrontUnitsQuery {
  return admin
    .from("units")
    .select(columns)
    .eq("marketplace_published", true)
    .eq("active", true)
    .not("slug", "is", null)
    .not("base_price", "is", null)
    .in("organization_id", orgIds);
}

export interface StorefrontUnitRef {
  id: string;
  organization_id: string;
  slug: string;
}

/**
 * Referencia mínima de una unidad SI está en la vidriera; null si no existe,
 * no está publicada o es de una organización que no vende en la web.
 * Para acciones públicas que reciben un `unitId` del cliente.
 */
export const getStorefrontUnitRef = cache(
  async (unitId: string): Promise<StorefrontUnitRef | null> => {
    if (!isUuid(unitId)) return null;
    const orgIds = await getStorefrontOrgIds();
    if (orgIds.length === 0) return null;
    const admin = createAdminClient();
    const { data, error } = await storefrontUnitsQuery(admin, orgIds, "id, organization_id, slug")
      .eq("id", unitId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as { id: string; organization_id: string; slug: string };
    return { id: row.id, organization_id: row.organization_id, slug: row.slug };
  },
);

// ─── Lecturas paginadas ──────────────────────────────────────────────────────

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Recorre `.range()` hasta que una página vuelve incompleta (mismo criterio que
 * `fetchAllPages` de finance/results-loader). PostgREST corta cada respuesta
 * en `max_rows` (1000 en Supabase) SIN avisar: hoy son ~580 fotos, así que una
 * sola consulta alcanzaba… hasta el día en que dejara de alcanzar y las
 * últimas unidades aparecieran sin fotos. El builder tiene que ordenar por
 * algo único para que las páginas no se pisen.
 */
async function readAllPages<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const SIZE = 1000;
  const out: T[] = [];
  for (let from = 0; from < SIZE * 50; from += SIZE) {
    const { data, error } = await page(from, from + SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < SIZE) break;
  }
  return out;
}

/** Tandas para `.in()`: la lista de ids viaja en la URL. */
const IN_CHUNK = 150;

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Imágenes (sólo `media_type = 'image'`, portada primero, hasta 6 por unidad
 * más el total) y amenities de un conjunto de unidades, con lectura paginada.
 * Lo usan el catálogo, el buscador viejo y los favoritos.
 */
export async function loadPhotosAndAmenities(admin: AdminClient, unitIds: string[]) {
  if (unitIds.length === 0) {
    return {
      photos: groupPhotosByUnit([]),
      amenities: groupAmenitiesByUnit([]),
    };
  }
  const tandas = chunk(unitIds, IN_CHUNK);
  const [photoRows, amenityRows] = await Promise.all([
    Promise.all(
      tandas.map((ids) =>
        readAllPages<{ unit_id: string; public_url: string | null; is_cover: boolean | null; sort_order: number | null }>(
          (from, to) =>
            admin
              .from("unit_photos")
              .select("unit_id, public_url, is_cover, sort_order")
              .eq("media_type", "image")
              .in("unit_id", ids)
              .order("unit_id", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
        ),
      ),
    ),
    Promise.all(
      tandas.map((ids) =>
        readAllPages<{ unit_id: string; amenity_code: string | null }>((from, to) =>
          admin
            .from("unit_marketplace_amenities")
            .select("unit_id, amenity_code")
            .in("unit_id", ids)
            .order("unit_id", { ascending: true })
            .order("amenity_code", { ascending: true })
            .range(from, to),
        ),
      ),
    ),
  ]);
  return {
    photos: groupPhotosByUnit(photoRows.flat()),
    amenities: groupAmenitiesByUnit(amenityRows.flat()),
  };
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

async function loadCatalog(): Promise<StorefrontCatalog> {
  const generatedAt = new Date().toISOString();
  // Sin caché intermedia: el catálogo ya se cachea entero y así cada armado
  // ve el estado actual de `marketplace_enabled`.
  const orgIds = await loadStorefrontOrgIds();
  if (orgIds.length === 0) return { listings: [], hoods: [], generated_at: generatedAt };

  const admin = createAdminClient();
  const rows = await readAllPages<UnitRow>((from, to) =>
    storefrontUnitsQuery(admin, orgIds, UNIT_SUMMARY_COLUMNS)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (rows.length === 0) return { listings: [], hoods: [], generated_at: generatedAt };

  const { photos, amenities } = await loadPhotosAndAmenities(
    admin,
    rows.map((r) => r.id),
  );
  const summaries = rows.map((r) =>
    rowToSummary(r, photos.get(r.id)?.urls ?? [], amenities.get(r.id) ?? []),
  );
  const imageCounts = new Map(Array.from(photos, ([id, set]) => [id, set.count] as const));
  const catalog = assembleCatalog({ summaries, imageCounts, generatedAt });

  // Reglas de precio activas: el total de la tarjeta para unas fechas tiene que
  // dar lo mismo que el checkout (que recalcula con ellas).
  const { data: ruleRows, error: rulesErr } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .in("unit_id", rows.map((r) => r.id))
    .eq("active", true);
  if (rulesErr) throw new Error(`No se pudo leer la vidriera: ${rulesErr.message}`);
  const rulesByUnit = new Map<string, UnitPricingRule[]>();
  for (const rule of (ruleRows ?? []) as UnitPricingRule[]) {
    const list = rulesByUnit.get(rule.unit_id) ?? [];
    list.push(rule);
    rulesByUnit.set(rule.unit_id, list);
  }
  return {
    ...catalog,
    listings: catalog.listings.map((l) => ({ ...l, pricing_rules: rulesByUnit.get(l.id) ?? [] })),
  };
}

/**
 * Catálogo completo de la vidriera, ordenado "recomendado", con los campos de
 * display, hasta 6 imágenes por unidad y los barrios con su conteo.
 * Cacheado 300 s con el tag `storefront-catalog`. Un error de lectura se
 * LANZA (no se cachea un catálogo vacío): en ISR queda la versión anterior.
 */
export const getStorefrontCatalog = cache(async (): Promise<StorefrontCatalog> => {
  return unstable_cache(loadCatalog, ["storefront-catalog"], {
    revalidate: 300,
    tags: [STOREFRONT_TAG],
  })();
});

/** Slugs de la vidriera (generateStaticParams de /u/[slug] y sitemap). */
export async function getStorefrontSlugs(): Promise<string[]> {
  const catalog = await getStorefrontCatalog();
  return catalog.listings.map((l) => l.slug);
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

const DETAIL_COLUMNS = "*, organization:organizations(id, name, logo_url)";

/** Fotos + videos, amenities y reglas de precio activas de una unidad. */
async function loadDetail(admin: AdminClient, row: UnitRow): Promise<StorefrontListingDetail> {
  const [photosRes, amenitiesRes, rulesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("*")
      .eq("unit_id", row.id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
    admin.from("unit_marketplace_amenities").select("amenity_code").eq("unit_id", row.id),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", row.id)
      .eq("active", true)
      .order("priority", { ascending: false }),
  ]);
  // Sin las reglas el precio saldría mal (el checkout recalcula con ellas):
  // mejor fallar visible que cotizar de menos.
  const failed = photosRes.error ?? amenitiesRes.error ?? rulesRes.error;
  if (failed) throw new Error(`No se pudo leer la unidad: ${failed.message}`);

  const photos = (photosRes.data ?? []) as UnitPhoto[];
  const pricingRules = (rulesRes.data ?? []) as UnitPricingRule[];
  const amenities = (amenitiesRes.data ?? []).map((a) => a.amenity_code as string);

  // El resumen (portada / photo_urls) sólo usa imágenes; los videos van en
  // `photos` para la galería, nunca como portada ni en las tarjetas.
  const images = photos.filter((p) => p.media_type === "image" && p.public_url);
  const summary = rowToSummary(
    row,
    images.map((p) => p.public_url),
    amenities,
  );

  const detail: MarketplaceListingDetail = {
    ...summary,
    marketplace_description: row.marketplace_description ?? null,
    house_rules: row.house_rules ?? null,
    cancellation_policy: (row.cancellation_policy as CancellationPolicy | null) ?? "flexible",
    check_in_window_start: row.check_in_window_start ?? "15:00",
    check_in_window_end: row.check_in_window_end ?? "22:00",
    photos,
    pricing_rules: pricingRules,
    organization_name: row.organization?.name ?? "",
    organization_logo_url: row.organization?.logo_url ?? null,
  };
  return withDisplayFields(detail);
}

async function readDetail(
  filter: { slug: string } | { id: string },
): Promise<StorefrontListingDetail | null> {
  const orgIds = await getStorefrontOrgIds();
  if (orgIds.length === 0) return null;
  const admin = createAdminClient();
  const base = storefrontUnitsQuery(admin, orgIds, DETAIL_COLUMNS);
  const { data, error } = await ("slug" in filter
    ? base.eq("slug", filter.slug)
    : base.eq("id", filter.id)
  ).maybeSingle();
  if (error) throw new Error(`No se pudo leer la unidad: ${error.message}`);
  if (!data) return null;
  return loadDetail(admin, data as unknown as UnitRow);
}

/**
 * Ficha de una unidad de la vidriera por slug (página /u/[slug]); null si no
 * existe o no está en la vidriera. Deduplicada por request (`React.cache`):
 * `generateMetadata` y la página comparten la misma lectura. Lanza ante un
 * error de la base (no es "no existe").
 */
export const getStorefrontListingBySlug = cache(
  async (slug: string): Promise<StorefrontListingDetail | null> => {
    const clean = typeof slug === "string" ? slug.trim() : "";
    if (!clean || clean.length > 200) return null;
    return readDetail({ slug: clean });
  },
);

/** Lo mismo por id (checkout, seguimiento). null si no está en la vidriera. */
export const getStorefrontListingById = cache(
  async (unitId: string): Promise<StorefrontListingDetail | null> => {
    if (!isUuid(unitId)) return null;
    return readDetail({ id: unitId });
  },
);
