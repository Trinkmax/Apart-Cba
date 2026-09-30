"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type {
  MarketplaceListingSummary,
  Review,
  UnitPricingRule,
} from "@/lib/types/database";
import { getBlockedDates, getUnavailableUnitIds } from "@/lib/marketplace/availability";
import { addDaysIso, computePricing, todayIsoAR } from "@/lib/marketplace/pricing";
import {
  isIsoDay,
  rowToSummary,
  UNIT_SUMMARY_COLUMNS,
  type UnitRow,
} from "@/lib/marketplace/catalog";
import {
  getStorefrontOrgIds,
  getStorefrontUnitRef,
  isUuid,
  loadPhotosAndAmenities,
  storefrontUnitsQuery,
} from "@/lib/marketplace/storefront";

/*
 * Lecturas públicas del marketplace. TODAS pasan por la vidriera
 * (`@/lib/marketplace/storefront`): unidades publicadas y activas, con slug y
 * precio, de organizaciones que venden en la web. El mismo proyecto aloja
 * organizaciones demo con reseñas inventadas que no pueden asomar en
 * www.apartcba.com, ni por una página ni llamando a la acción a mano.
 */

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
  /**
   * Modo de estadía (tabs Temporales/Mensuales). Mapea a units.default_mode:
   * "temporario" incluye las unidades mixtas, "mensual" también. Sin valor no
   * se filtra (p.ej. favoritos, mapa con bbox heredando el modo por separado).
   */
  mode?: "temporario" | "mensual" | null;
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

  const orgIds = await getStorefrontOrgIds();
  if (orgIds.length === 0) return { listings: [], total: 0 };

  // Scope de vidriera + `monthly_price` (sin él la renta mensual sale null).
  let q = storefrontUnitsQuery(admin, orgIds, UNIT_SUMMARY_COLUMNS);

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
  if (filters.mode) {
    // "mixto" acepta ambos modos, así que entra en las dos pestañas.
    q = q.in("default_mode", [filters.mode, "mixto"]);
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
  //    Misma lógica que el buscador nuevo (`getUnavailableUnitIds`): reservas
  //    que ocupan, pedidos vigentes y solicitudes de canal que retienen según la
  //    política de cada organización. Fechas mal formadas o invertidas = sin
  //    filtro (como antes), en vez de reventar la página.
  const checkIn = filters.checkIn;
  const checkOut = filters.checkOut;
  if (isIsoDay(checkIn) && isIsoDay(checkOut) && checkOut > checkIn) {
    const blocked = new Set(
      await getUnavailableUnitIds({
        unitIds: unitsRaw.map((u) => u.id),
        checkInIso: checkIn,
        checkOutIso: checkOut,
      }),
    );
    unitsRaw = unitsRaw.filter((u) => !blocked.has(u.id));
  }

  if (unitsRaw.length === 0) {
    return { listings: [], total: 0 };
  }

  // 2) Fotos + amenities para el conjunto ya filtrado por disponibilidad.
  //    Lectura paginada (el tope silencioso de 1000 filas de PostgREST dejaba
  //    sin fotos a las últimas unidades), portada primero.
  const { photos, amenities } = await loadPhotosAndAmenities(
    admin,
    unitsRaw.map((u) => u.id),
  );

  let listings = unitsRaw.map((u) =>
    rowToSummary(u, photos.get(u.id)?.urls ?? [], amenities.get(u.id) ?? [])
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
  // podría reservar ni esta noche. "Hoy" en horario AR (no UTC) para no rodar de
  // día después de las 21:00 local.
  const today = todayIsoAR();
  const { listings } = await searchListings({
    sort: "rating",
    limit,
    checkIn: today,
    checkOut: addDaysIso(today, 1),
    // La vidriera de la home es de temporarios (la pestaña default del sitio).
    mode: "temporario",
  });
  return listings;
}

/**
 * Reseñas publicadas de una unidad de la vidriera ([] si la unidad no está en
 * la vidriera: las organizaciones demo tienen reseñas inventadas). Un error de
 * lectura se lanza: en una página ISR deja la versión anterior en pie.
 */
export async function getReviewsForUnit(unitId: string): Promise<Review[]> {
  const unit = await getStorefrontUnitRef(unitId);
  if (!unit) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("reviews")
    .select("*")
    .eq("unit_id", unit.id)
    .eq("organization_id", unit.organization_id)
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
  // Pública: la ocupación de una unidad que no está en la vidriera no se muestra.
  const unit = await getStorefrontUnitRef(params.unitId);
  if (!unit) return [];
  if (!isIsoDay(params.fromIso) || !isIsoDay(params.toIso) || params.toIso <= params.fromIso) {
    return [];
  }
  return getBlockedDates({ unitId: unit.id, fromIso: params.fromIso, toIso: params.toIso });
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
  if (
    !isIsoDay(params.checkIn) ||
    !isIsoDay(params.checkOut) ||
    params.checkOut <= params.checkIn ||
    // Tope de 365 noches (como el checkout): computePricing recorre noche a noche.
    params.checkOut > addDaysIso(params.checkIn, 365)
  ) {
    throw new Error("Las fechas son inválidas");
  }
  if (!isUuid(params.unitId)) throw new Error("La unidad no está disponible");

  const orgIds = await getStorefrontOrgIds();
  if (orgIds.length === 0) throw new Error("La unidad no está disponible");
  const admin = createAdminClient();
  const { data, error } = await storefrontUnitsQuery(
    admin,
    orgIds,
    "base_price, cleaning_fee, marketplace_currency, min_nights, max_nights",
  )
    .eq("id", params.unitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("La unidad no está disponible");
  const unit = data as {
    base_price: number | null;
    cleaning_fee: number | null;
    marketplace_currency: string | null;
    min_nights: number | null;
    max_nights: number | null;
  };

  const { data: rules, error: rulesError } = await admin
    .from("unit_pricing_rules")
    .select("*")
    .eq("unit_id", params.unitId)
    .eq("active", true);
  // Sin las reglas la cotización saldría de menos: mejor fallar visible.
  if (rulesError) throw new Error(rulesError.message);

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
