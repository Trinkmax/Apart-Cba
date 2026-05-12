import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { computePricing, countNights } from "@/lib/marketplace/pricing";
import { CheckoutForm } from "@/components/marketplace/checkout-form";
import { requireGuestSession } from "@/lib/actions/guest-auth";
import { checkUnitAvailability } from "@/lib/marketplace/availability";
import type { MarketplaceListingDetail, UnitPhoto, UnitPricingRule } from "@/lib/types/database";

export const metadata = {
  title: "Confirmar reserva · rentOS",
};

type Params = Promise<{ unitId: string }>;
type SearchParams = Promise<Record<string, string | undefined>>;

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { unitId } = await params;
  const sp = await searchParams;

  const checkIn = sp.checkin ?? "";
  const checkOut = sp.checkout ?? "";
  const guestsCount = sp.huespedes ? parseInt(sp.huespedes, 10) : 1;

  if (!checkIn || !checkOut || checkOut <= checkIn) {
    redirect(`/u/${unitId}`);
  }
  if (countNights(checkIn, checkOut) < 1) {
    redirect(`/u/${unitId}`);
  }

  // Requiere sesión de huésped (redirige a /ingresar si no hay)
  const session = await requireGuestSession();

  const admin = createAdminClient();
  const { data: unit } = await admin
    .from("units")
    .select(
      `
        *,
        organization:organizations(id, name, logo_url)
      `
    )
    .eq("id", unitId)
    .eq("marketplace_published", true)
    .eq("active", true)
    .maybeSingle();
  if (!unit) notFound();

  // Re-validar disponibilidad server-side
  const avail = await checkUnitAvailability({ unitId, checkInIso: checkIn, checkOutIso: checkOut });
  if (!avail.available) {
    redirect(`/u/${unit.slug ?? unitId}?error=${encodeURIComponent(avail.reason ?? "")}`);
  }

  const [photosRes, rulesRes, amenitiesRes] = await Promise.all([
    admin
      .from("unit_photos")
      .select("*")
      .eq("unit_id", unitId)
      .order("is_cover", { ascending: false })
      .order("sort_order"),
    admin
      .from("unit_pricing_rules")
      .select("*")
      .eq("unit_id", unitId)
      .eq("active", true),
    admin
      .from("unit_marketplace_amenities")
      .select("amenity_code")
      .eq("unit_id", unitId),
  ]);

  const photos = (photosRes.data ?? []) as UnitPhoto[];
  const rules = (rulesRes.data ?? []) as UnitPricingRule[];
  const currency = unit.marketplace_currency ?? "ARS";

  const pricing = computePricing({
    checkInIso: checkIn,
    checkOutIso: checkOut,
    basePrice: Number(unit.base_price ?? 0),
    cleaningFee: unit.cleaning_fee !== null ? Number(unit.cleaning_fee) : null,
    rules,
  });

  const listing: MarketplaceListingDetail = {
    id: unit.id,
    organization_id: unit.organization_id,
    slug: unit.slug ?? unit.id,
    marketplace_title: unit.marketplace_title ?? unit.name,
    marketplace_property_type: unit.marketplace_property_type ?? "apartamento",
    neighborhood: unit.neighborhood,
    city: null,
    address: unit.address,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    max_guests: unit.max_guests,
    size_m2: unit.size_m2 ? Number(unit.size_m2) : null,
    latitude: unit.latitude !== null ? Number(unit.latitude) : null,
    longitude: unit.longitude !== null ? Number(unit.longitude) : null,
    base_price: Number(unit.base_price ?? 0),
    marketplace_currency: currency,
    cleaning_fee: unit.cleaning_fee !== null ? Number(unit.cleaning_fee) : null,
    instant_book: unit.instant_book,
    rating_avg: Number(unit.marketplace_rating_avg ?? 0),
    rating_count: unit.marketplace_rating_count ?? 0,
    cover_url: photos[0]?.public_url ?? unit.cover_image_url,
    photo_urls: photos.map((p) => p.public_url),
    amenities: (amenitiesRes.data ?? []).map((a) => a.amenity_code),
    marketplace_description: unit.marketplace_description,
    house_rules: unit.house_rules,
    cancellation_policy: (unit.cancellation_policy ?? "flexible") as MarketplaceListingDetail["cancellation_policy"],
    min_nights: unit.min_nights ?? 1,
    max_nights: unit.max_nights ?? null,
    check_in_window_start: unit.check_in_window_start ?? "15:00",
    check_in_window_end: unit.check_in_window_end ?? "22:00",
    photos,
    pricing_rules: rules,
    organization_name: (unit.organization as { name?: string } | null)?.name ?? "",
    organization_logo_url: (unit.organization as { logo_url?: string | null } | null)?.logo_url ?? null,
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-8 md:py-12">
      <h1 className="text-3xl md:text-4xl font-semibold text-neutral-900 mb-8 md:mb-12">
        Confirmá y reservá
      </h1>
      <CheckoutForm
        listing={listing}
        guest={session.profile}
        guestEmail={session.email}
        pricing={pricing}
        currency={currency}
        checkIn={checkIn}
        checkOut={checkOut}
        guestsCount={guestsCount}
      />
    </div>
  );
}
