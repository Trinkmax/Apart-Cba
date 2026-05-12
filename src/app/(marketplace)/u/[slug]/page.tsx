import { notFound } from "next/navigation";
import { ChevronLeft, Share, Heart } from "lucide-react";
import Link from "next/link";
import { UnitGallery } from "@/components/marketplace/unit-gallery";
import { UnitDetailInfo } from "@/components/marketplace/unit-detail-info";
import { UnitBookingWidget } from "@/components/marketplace/unit-booking-widget";
import { UnitLocationMap } from "@/components/marketplace/unit-location-map";
import {
  getListingBlockedDates,
  getListingBySlug,
  getReviewsForUnit,
} from "@/lib/actions/marketplace";
import { listMarketplaceAmenitiesCatalog } from "@/lib/actions/listings";
import { getGuestSession } from "@/lib/actions/guest-auth";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | undefined>>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Alojamiento no encontrado · rentOS" };
  return {
    title: `${listing.marketplace_title} · rentOS`,
    description:
      listing.marketplace_description?.slice(0, 200) ??
      `Reservá ${listing.marketplace_title} en rentOS.`,
    openGraph: listing.cover_url ? { images: [{ url: listing.cover_url }] } : undefined,
  };
}

export default async function UnitPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const toIso = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  })();

  const [blockedDates, reviews, amenitiesCatalog, session] = await Promise.all([
    getListingBlockedDates({ unitId: listing.id, fromIso: today, toIso }),
    getReviewsForUnit(listing.id),
    listMarketplaceAmenitiesCatalog(),
    getGuestSession(),
  ]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-4 md:pt-8">
      {/* Top toolbar */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <Link
          href="/buscar"
          className="inline-flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900"
        >
          <ChevronLeft size={16} />
          Volver
        </Link>
        <div className="hidden md:flex items-center gap-1">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg">
            <Share size={14} />
            Compartir
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg">
            <Heart size={14} />
            Guardar
          </button>
        </div>
      </div>

      {/* Gallery */}
      <div className="relative">
        <UnitGallery photos={listing.photos} title={listing.marketplace_title} />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 lg:gap-12 mt-8 md:mt-12 pb-12">
        <div>
          <UnitDetailInfo
            listing={listing}
            amenitiesCatalog={amenitiesCatalog}
            reviews={reviews}
          />

          {listing.latitude !== null && listing.longitude !== null ? (
            <section className="mt-8 pt-8 border-t border-neutral-200">
              <h3 className="text-xl font-semibold text-neutral-900 mb-4">
                Dónde vas a estar
              </h3>
              <UnitLocationMap
                latitude={listing.latitude}
                longitude={listing.longitude}
                neighborhood={listing.neighborhood}
              />
              <p className="mt-3 text-sm text-neutral-600">
                <strong className="text-neutral-900">
                  {listing.neighborhood ?? "Ubicación"}
                </strong>
                {listing.address ? ` · ${listing.address}` : ""}
              </p>
            </section>
          ) : null}
        </div>

        {/* Booking widget */}
        <aside className="lg:sticky lg:top-28 self-start">
          <UnitBookingWidget
            listing={listing}
            blockedDates={blockedDates}
            isAuthenticated={Boolean(session)}
            prefillCheckIn={sp.checkin ?? null}
            prefillCheckOut={sp.checkout ?? null}
            prefillGuests={sp.huespedes ? parseInt(sp.huespedes, 10) : null}
          />
        </aside>
      </div>
    </div>
  );
}
