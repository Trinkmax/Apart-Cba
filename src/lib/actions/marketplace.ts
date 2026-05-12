"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type {
  MarketplaceListingDetail,
  MarketplaceListingSummary,
  Review,
  UnitPhoto,
  UnitPricingRule,
} from "@/lib/types/database";
import { getBlockedDates } from "@/lib/marketplace/availability";
import { computePricing } from "@/lib/marketplace/pricing";

export type SearchFilters = {
  city?: string | null;
  neighborhood?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: number | null;
  bedroomsMin?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  amenities?: string[] | null;
  instantBookOnly?: boolean | null;
  propertyTypes?: string[] | null;
  /** Bounding box [minLat, minLng, maxLat, maxLng] (mapa). */
  bbox?: [number, number, number, number] | null;
  sort?: "recommended" | "price_asc" | "price_desc" | "rating";
  limit?: number;
  offset?: number;
};

type UnitRow = {
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
  marketplace_currency: string | null;
  cleaning_fee: number | null;
  instant_book: boolean;
  marketplace_rating_avg: number | null;
  marketplace_rating_count: number | null;
  cover_image_url: string | null;
  marketplace_description: string | null;
  house_rules: string | null;
  cancellation_policy: string | null;
  min_nights: number;
  max_nights: number | null;
  check_in_window_start: string | null;
  check_in_window_end: string | null;
  organization?: { id: string; name: string; logo_url: string | null } | null;
};

function rowToSummary(
  row: UnitRow,
  photoUrls: string[],
  amenities: string[]
): MarketplaceListingSummary {
  return {
    id: row.id,
    organization_id: row.organization_id,
    slug: row.slug ?? row.id,
    marketplace_title: row.marketplace_title ?? row.name,
    marketplace_property_type: row.marketplace_property_type ?? "apartamento",
    neighborhood: row.neighborhood,
    city: row.city,
    address: row.address,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    max_guests: row.max_guests,
    size_m2: row.size_m2 ? Number(row.size_m2) : null,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    base_price: Number(row.base_price ?? 0),
    marketplace_currency: row.marketplace_currency ?? "ARS",
    cleaning_fee: row.cleaning_fee !== null ? Number(row.cleaning_fee) : null,
    instant_book: row.instant_book,
    rating_avg: Number(row.marketplace_rating_avg ?? 0),
    rating_count: row.marketplace_rating_count ?? 0,
    cover_url: photoUrls[0] ?? row.cover_image_url,
    photo_urls: photoUrls,
    amenities,
  };
}

/**
 * Buscar unidades publicadas en el marketplace, con filtros.
 * Devuelve un array de listings y el total para paginación.
 */
export async function searchListings(filters: SearchFilters): Promise<{
  listings: MarketplaceListingSummary[];
  total: number;
}> {
  const admin = createAdminClient();
  const limit = Math.min(filters.limit ?? 30, 60);
  const offset = filters.offset ?? 0;

  let q = admin
    .from("units")
    .select(
      `
        id, organization_id, slug, marketplace_title, name, marketplace_property_type,
        neighborhood, address, bedrooms, bathrooms, max_guests, size_m2,
        latitude, longitude, base_price, marketplace_currency, cleaning_fee, instant_book,
        marketplace_rating_avg, marketplace_rating_count, cover_image_url, min_nights, max_nights
      `,
      { count: "exact" }
    )
    .eq("marketplace_published", true)
    .eq("active", true)
    .not("slug", "is", null)
    .not("base_price", "is", null);

  if (filters.city) {
    q = q.or(
      `address.ilike.%${filters.city}%,neighborhood.ilike.%${filters.city}%`
    );
  }
  if (filters.neighborhood) {
    q = q.ilike("neighborhood", `%${filters.neighborhood}%`);
  }
  if (filters.guests && filters.guests > 0) {
    q = q.gte("max_guests", filters.guests);
  }
  if (filters.bedroomsMin && filters.bedroomsMin > 0) {
    q = q.gte("bedrooms", filters.bedroomsMin);
  }
  if (filters.priceMin) q = q.gte("base_price", filters.priceMin);
  if (filters.priceMax) q = q.lte("base_price", filters.priceMax);
  if (filters.instantBookOnly) q = q.eq("instant_book", true);
  if (filters.propertyTypes && filters.propertyTypes.length > 0) {
    q = q.in("marketplace_property_type", filters.propertyTypes);
  }
  if (filters.bbox) {
    const [minLat, minLng, maxLat, maxLng] = filters.bbox;
    q = q
      .gte("latitude", minLat)
      .lte("latitude", maxLat)
      .gte("longitude", minLng)
      .lte("longitude", maxLng);
  }

  // Sort
  switch (filters.sort) {
    case "price_asc":
      q = q.order("base_price", { ascending: true });
      break;
    case "price_desc":
      q = q.order("base_price", { ascending: false });
      break;
    case "rating":
      q = q
        .order("marketplace_rating_avg", { ascending: false })
        .order("marketplace_rating_count", { ascending: false });
      break;
    default:
      // recommended: rating count + avg (orgs con más reviews suben)
      q = q
        .order("marketplace_rating_count", { ascending: false })
        .order("marketplace_rating_avg", { ascending: false })
        .order("created_at", { ascending: false });
  }

  q = q.range(offset, offset + limit - 1);

  const { data: rows, error, count } = await q;
  if (error) throw new Error(`Error buscando: ${error.message}`);
  const unitsRaw = (rows ?? []) as UnitRow[];

  if (unitsRaw.length === 0) {
    return { listings: [], total: count ?? 0 };
  }

  const unitIds = unitsRaw.map((u) => u.id);

  // Fetch fotos + amenities en paralelo
  const [photosRes, amenitiesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("unit_id, public_url, sort_order, is_cover")
      .in("unit_id", unitIds)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
    admin
      .from("unit_marketplace_amenities")
      .select("unit_id, amenity_code")
      .in("unit_id", unitIds),
  ]);

  const photosByUnit = new Map<string, string[]>();
  for (const p of photosRes.data ?? []) {
    const arr = photosByUnit.get(p.unit_id) ?? [];
    if (arr.length < 5) arr.push(p.public_url);
    photosByUnit.set(p.unit_id, arr);
  }
  const amenitiesByUnit = new Map<string, string[]>();
  for (const a of amenitiesRes.data ?? []) {
    const arr = amenitiesByUnit.get(a.unit_id) ?? [];
    arr.push(a.amenity_code);
    amenitiesByUnit.set(a.unit_id, arr);
  }

  // Si hay rango de fechas → filtrar las que no tengan disponibilidad
  let listings = unitsRaw.map((u) =>
    rowToSummary(u, photosByUnit.get(u.id) ?? [], amenitiesByUnit.get(u.id) ?? [])
  );

  if (filters.checkIn && filters.checkOut) {
    const checkIn = filters.checkIn;
    const checkOut = filters.checkOut;

    const [bookingsRes, requestsRes] = await Promise.all([
      admin
        .from("bookings")
        .select("unit_id")
        .in("unit_id", unitIds)
        .in("status", ["confirmada", "check_in"])
        .lt("check_in_date", checkOut)
        .gt("check_out_date", checkIn),
      admin
        .from("booking_requests")
        .select("unit_id")
        .in("unit_id", unitIds)
        .eq("status", "pendiente")
        .gt("expires_at", new Date().toISOString())
        .lt("check_in_date", checkOut)
        .gt("check_out_date", checkIn),
    ]);

    const blocked = new Set<string>();
    for (const r of bookingsRes.data ?? []) blocked.add(r.unit_id);
    for (const r of requestsRes.data ?? []) blocked.add(r.unit_id);

    listings = listings.filter((l) => !blocked.has(l.id));
  }

  // Filtrar por amenities (post-fetch — más simple que un join complejo)
  if (filters.amenities && filters.amenities.length > 0) {
    const need = filters.amenities;
    listings = listings.filter((l) =>
      need.every((code) => l.amenities.includes(code))
    );
  }

  return { listings, total: count ?? listings.length };
}

export async function getFeaturedListings(limit = 8): Promise<MarketplaceListingSummary[]> {
  const { listings } = await searchListings({
    sort: "rating",
    limit,
  });
  return listings;
}

/**
 * Detalle completo para la página `/u/[slug]`.
 */
export async function getListingBySlug(
  slug: string
): Promise<MarketplaceListingDetail | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("units")
    .select(
      `
        *,
        organization:organizations(id, name, logo_url)
      `
    )
    .eq("slug", slug)
    .eq("marketplace_published", true)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as UnitRow;

  const [photosRes, amenitiesRes, rulesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("*")
      .eq("unit_id", row.id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
    admin
      .from("unit_marketplace_amenities")
      .select("amenity_code")
      .eq("unit_id", row.id),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", row.id)
      .eq("active", true)
      .order("priority", { ascending: false }),
  ]);

  const photos = (photosRes.data ?? []) as UnitPhoto[];
  const pricingRules = (rulesRes.data ?? []) as UnitPricingRule[];
  const amenities = (amenitiesRes.data ?? []).map((a) => a.amenity_code);

  const summary = rowToSummary(
    row,
    photos.map((p) => p.public_url),
    amenities
  );

  return {
    ...summary,
    marketplace_description: row.marketplace_description ?? null,
    house_rules: row.house_rules ?? null,
    cancellation_policy: (row.cancellation_policy as MarketplaceListingDetail["cancellation_policy"]) ?? "flexible",
    min_nights: row.min_nights ?? 1,
    max_nights: row.max_nights ?? null,
    check_in_window_start: row.check_in_window_start ?? "15:00",
    check_in_window_end: row.check_in_window_end ?? "22:00",
    photos,
    pricing_rules: pricingRules,
    organization_name: row.organization?.name ?? "",
    organization_logo_url: row.organization?.logo_url ?? null,
  };
}

export async function getReviewsForUnit(unitId: string): Promise<Review[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reviews")
    .select("*")
    .eq("unit_id", unitId)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Review[];
}

export async function getListingBlockedDates(params: {
  unitId: string;
  fromIso: string;
  toIso: string;
}): Promise<string[]> {
  return getBlockedDates(params);
}

/**
 * Devuelve el desglose de precio para un rango dado contra el listing.
 * Pública: no requiere auth.
 */
export async function quoteListing(params: {
  unitId: string;
  checkIn: string;
  checkOut: string;
}) {
  const admin = createAdminClient();
  const { data: unit, error } = await admin
    .from("units")
    .select("base_price, cleaning_fee, marketplace_currency, min_nights, max_nights, marketplace_published, active")
    .eq("id", params.unitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!unit || !unit.marketplace_published || !unit.active) {
    throw new Error("La unidad no está disponible");
  }

  const { data: rules } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .eq("unit_id", params.unitId)
    .eq("active", true);

  const breakdown = computePricing({
    checkInIso: params.checkIn,
    checkOutIso: params.checkOut,
    basePrice: Number(unit.base_price ?? 0),
    cleaningFee: unit.cleaning_fee !== null ? Number(unit.cleaning_fee) : null,
    rules: (rules ?? []) as UnitPricingRule[],
  });

  return {
    breakdown,
    currency: unit.marketplace_currency ?? "ARS",
    min_nights: unit.min_nights ?? 1,
    max_nights: unit.max_nights ?? null,
  };
}

/** Para la página de búsqueda: lista de ciudades únicas (chips de destinos rápidos). */
export async function getPopularCities(): Promise<{ city: string; count: number }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("units")
    .select("address, neighborhood")
    .eq("marketplace_published", true)
    .eq("active", true);

  // Best effort: extraer "Córdoba", "Buenos Aires" del campo address por keyword
  const known = ["Córdoba", "Buenos Aires", "Mendoza", "Rosario", "Bariloche", "Mar del Plata", "Salta", "Tucumán"];
  const tally = new Map<string, number>();
  for (const row of data ?? []) {
    const hay = `${row.address ?? ""} ${row.neighborhood ?? ""}`;
    for (const k of known) {
      if (hay.toLowerCase().includes(k.toLowerCase())) {
        tally.set(k, (tally.get(k) ?? 0) + 1);
      }
    }
  }
  return Array.from(tally.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);
}
