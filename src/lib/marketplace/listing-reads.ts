import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  MarketplaceListingDetail,
  MarketplaceListingSummary,
  UnitDefaultMode,
  UnitPhoto,
  UnitPricingRule,
} from "@/lib/types/database";

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
  marketplace_currency: string | null;
  cleaning_fee: number | null;
  instant_book: boolean;
  default_mode: UnitDefaultMode | null;
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

export function rowToSummary(
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

/**
 * Detalle completo para la página `/u/[slug]`.
 *
 * Envuelto en `React.cache` para deduplicar dentro del mismo request:
 * `generateMetadata` y el componente de página corren en el mismo request,
 * así que ambos comparten una sola consulta en vez de dos.
 */
export const getListingBySlug = cache(
  async (slug: string): Promise<MarketplaceListingDetail | null> => {
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

    // El summary (cover/photo_urls) sólo usa imágenes; los videos no deben
    // aparecer como portada ni en los thumbnails de las cards.
    const images = photos.filter((p) => p.media_type === "image");
    const summary = rowToSummary(
      row,
      images.map((p) => p.public_url),
      amenities
    );

    return {
      ...summary,
      marketplace_description: row.marketplace_description ?? null,
      house_rules: row.house_rules ?? null,
      cancellation_policy:
        (row.cancellation_policy as MarketplaceListingDetail["cancellation_policy"]) ??
        "flexible",
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
);
