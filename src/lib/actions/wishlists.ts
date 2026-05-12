"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getGuestSession, requireGuestSession } from "./guest-auth";
import type { MarketplaceListingSummary } from "@/lib/types/database";

export async function toggleWishlist(unitId: string): Promise<{
  ok: boolean;
  added?: boolean;
  error?: string;
}> {
  const session = await getGuestSession();
  if (!session) return { ok: false, error: "Iniciá sesión para guardar favoritos" };
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("wishlists")
    .select("user_id")
    .eq("user_id", session.userId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("wishlists")
      .delete()
      .eq("user_id", session.userId)
      .eq("unit_id", unitId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/favoritos");
    revalidatePath("/mi-cuenta");
    return { ok: true, added: false };
  } else {
    const { error } = await admin
      .from("wishlists")
      .insert({ user_id: session.userId, unit_id: unitId });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/favoritos");
    revalidatePath("/mi-cuenta");
    return { ok: true, added: true };
  }
}

export async function listWishlistUnitIds(): Promise<Set<string>> {
  const session = await getGuestSession();
  if (!session) return new Set();
  const admin = createAdminClient();
  const { data } = await admin
    .from("wishlists")
    .select("unit_id")
    .eq("user_id", session.userId);
  return new Set((data ?? []).map((r) => r.unit_id));
}

export async function listWishlistDetails(): Promise<MarketplaceListingSummary[]> {
  const session = await requireGuestSession();
  const admin = createAdminClient();

  const { data: wishRows } = await admin
    .from("wishlists")
    .select("unit_id, added_at")
    .eq("user_id", session.userId)
    .order("added_at", { ascending: false });

  const ids = (wishRows ?? []).map((r) => r.unit_id);
  if (ids.length === 0) return [];

  const { data: units } = await admin
    .from("units")
    .select(
      `
        id, organization_id, slug, marketplace_title, name, marketplace_property_type,
        neighborhood, address, bedrooms, bathrooms, max_guests, size_m2,
        latitude, longitude, base_price, marketplace_currency, cleaning_fee, instant_book,
        marketplace_rating_avg, marketplace_rating_count, cover_image_url
      `
    )
    .in("id", ids)
    .eq("marketplace_published", true)
    .eq("active", true);

  const unitsArr = units ?? [];
  if (unitsArr.length === 0) return [];

  const [photosRes, amenitiesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("unit_id, public_url, is_cover, sort_order")
      .in("unit_id", unitsArr.map((u) => u.id))
      .order("is_cover", { ascending: false })
      .order("sort_order"),
    admin
      .from("unit_marketplace_amenities")
      .select("unit_id, amenity_code")
      .in("unit_id", unitsArr.map((u) => u.id)),
  ]);

  const photosByUnit = new Map<string, string[]>();
  for (const p of photosRes.data ?? []) {
    const arr = photosByUnit.get(p.unit_id) ?? [];
    if (arr.length < 4) arr.push(p.public_url);
    photosByUnit.set(p.unit_id, arr);
  }
  const amenitiesByUnit = new Map<string, string[]>();
  for (const a of amenitiesRes.data ?? []) {
    const arr = amenitiesByUnit.get(a.unit_id) ?? [];
    arr.push(a.amenity_code);
    amenitiesByUnit.set(a.unit_id, arr);
  }

  // Preservar el orden cronológico
  return ids
    .map((id) => unitsArr.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      id: u.id,
      organization_id: u.organization_id,
      slug: u.slug ?? u.id,
      marketplace_title: u.marketplace_title ?? u.name,
      marketplace_property_type: u.marketplace_property_type ?? "apartamento",
      neighborhood: u.neighborhood,
      city: null,
      address: u.address,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      max_guests: u.max_guests,
      size_m2: u.size_m2 ? Number(u.size_m2) : null,
      latitude: u.latitude !== null ? Number(u.latitude) : null,
      longitude: u.longitude !== null ? Number(u.longitude) : null,
      base_price: Number(u.base_price ?? 0),
      marketplace_currency: u.marketplace_currency ?? "ARS",
      cleaning_fee: u.cleaning_fee !== null ? Number(u.cleaning_fee) : null,
      instant_book: u.instant_book,
      rating_avg: Number(u.marketplace_rating_avg ?? 0),
      rating_count: u.marketplace_rating_count ?? 0,
      cover_url: (photosByUnit.get(u.id) ?? [])[0] ?? u.cover_image_url,
      photo_urls: photosByUnit.get(u.id) ?? [],
      amenities: amenitiesByUnit.get(u.id) ?? [],
    }));
}
