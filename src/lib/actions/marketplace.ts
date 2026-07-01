"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type {
  MarketplaceListingSummary,
  Review,
  UnitPricingRule,
} from "@/lib/types/database";
import {
  getBlockedDates,
  OCCUPYING_BOOKING_STATUSES,
} from "@/lib/marketplace/availability";
import { addDaysIso, computePricing } from "@/lib/marketplace/pricing";
import { rowToSummary, type UnitRow } from "@/lib/marketplace/listing-reads";

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

  // Los filtros por disponibilidad (fechas) y amenities se resuelven en memoria,
  // así que NO podemos paginar en la DB ni usar count:"exact" (darían totales y
  // páginas inconsistentes — el bug de "40 lugares" mostrando 25). Traemos el
  // conjunto que matchea los filtros SQL con una cota de seguridad y paginamos
  // ya filtrado. A escala grande esto debería moverse a un RPC / columna
  // materializada de "próxima fecha disponible".
  const HARD_SCAN_CAP = 500;

  let q = admin
    .from("units")
    .select(
      `
        id, organization_id, slug, marketplace_title, name, marketplace_property_type,
        neighborhood, city, address, bedrooms, bathrooms, max_guests, size_m2,
        latitude, longitude, base_price, marketplace_currency, cleaning_fee, instant_book,
        marketplace_rating_avg, marketplace_rating_count, cover_image_url, min_nights, max_nights
      `
    )
    .eq("marketplace_published", true)
    .eq("active", true)
    .not("slug", "is", null)
    .not("base_price", "is", null);

  if (filters.city) {
    // El argumento de .or() lo parsea PostgREST: `,` `(` `)` `*` son estructurales.
    // Sin escapar, un `?ciudad=a,base_price.gt.0)` rompe el filtro (crash/DoS).
    const safeCity = filters.city.replace(/[,()*\\%]/g, "").trim();
    if (safeCity) {
      q = q.or(`address.ilike.%${safeCity}%,neighborhood.ilike.%${safeCity}%`);
    }
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

  q = q.limit(HARD_SCAN_CAP);

  const { data: rows, error } = await q;
  if (error) throw new Error(`Error buscando: ${error.message}`);
  let unitsRaw = (rows ?? []) as UnitRow[];

  if (unitsRaw.length === 0) {
    return { listings: [], total: 0 };
  }

  // 1) Filtro por disponibilidad (solo si hay rango de fechas). Se aplica ANTES
  //    de paginar para que el total y las páginas sean consistentes.
  if (filters.checkIn && filters.checkOut) {
    const checkIn = filters.checkIn;
    const checkOut = filters.checkOut;
    const ids = unitsRaw.map((u) => u.id);

    const [bookingsRes, requestsRes] = await Promise.all([
      admin
        .from("bookings")
        .select("unit_id")
        .in("unit_id", ids)
        .in("status", OCCUPYING_BOOKING_STATUSES as unknown as string[])
        .lt("check_in_date", checkOut)
        .gt("check_out_date", checkIn),
      admin
        .from("booking_requests")
        .select("unit_id")
        .in("unit_id", ids)
        .eq("status", "pendiente")
        .gt("expires_at", new Date().toISOString())
        .lt("check_in_date", checkOut)
        .gt("check_out_date", checkIn),
    ]);

    const blocked = new Set<string>();
    for (const r of bookingsRes.data ?? []) blocked.add(r.unit_id);
    for (const r of requestsRes.data ?? []) blocked.add(r.unit_id);

    unitsRaw = unitsRaw.filter((u) => !blocked.has(u.id));
  }

  if (unitsRaw.length === 0) {
    return { listings: [], total: 0 };
  }

  // 2) Fotos + amenities para el conjunto ya filtrado por disponibilidad.
  const unitIds = unitsRaw.map((u) => u.id);
  const [photosRes, amenitiesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("unit_id, public_url, sort_order, is_cover")
      .eq("media_type", "image")
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

  let listings = unitsRaw.map((u) =>
    rowToSummary(u, photosByUnit.get(u.id) ?? [], amenitiesByUnit.get(u.id) ?? [])
  );

  // 3) Filtro por amenities (en memoria).
  if (filters.amenities && filters.amenities.length > 0) {
    const need = filters.amenities;
    listings = listings.filter((l) =>
      need.every((code) => l.amenities.includes(code))
    );
  }

  // 4) Total exacto (ya filtrado) + paginación en memoria.
  const total = listings.length;
  const paged = listings.slice(offset, offset + limit);
  return { listings: paged, total };
}

export async function getFeaturedListings(limit = 8): Promise<MarketplaceListingSummary[]> {
  // La home no tiene fechas elegidas, pero igual excluimos lo que está ocupado
  // HOY (estadías largas activas) para no destacar propiedades que un huésped no
  // podría reservar ni esta noche.
  const today = new Date().toISOString().slice(0, 10);
  const { listings } = await searchListings({
    sort: "rating",
    limit,
    checkIn: today,
    checkOut: addDaysIso(today, 1),
  });
  return listings;
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
