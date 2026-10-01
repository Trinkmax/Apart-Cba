import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UnitGallery } from "@/components/marketplace/unit-gallery";
import { UnitDetailInfo } from "@/components/marketplace/unit-detail-info";
import { UnitBookingWidget } from "@/components/marketplace/unit-booking-widget";
import { MobileReserveBar } from "@/components/marketplace/mobile-reserve-bar";
import { ListingShareActions } from "@/components/marketplace/listing-share-actions";
import type { AmenityItem } from "@/components/marketplace/listing/amenities-block";
import { BackLink } from "@/components/marketplace/listing/back-link";
import { ListingErrorBanner } from "@/components/marketplace/listing/error-banner";
import { ListingHeader } from "@/components/marketplace/listing/listing-header";
import { ListingJsonLd } from "@/components/marketplace/listing/listing-json-ld";
import { SimilarListings } from "@/components/marketplace/listing/similar-listings";
import {
  ListingStayProvider,
  type StayListing,
  type StaySettings,
} from "@/components/marketplace/listing/stay-context";
import { ListingWhatsAppTopic } from "@/components/marketplace/listing/listing-whatsapp-topic";
import { getReviewsForUnit } from "@/lib/actions/marketplace";
import { listMarketplaceAmenitiesCatalog } from "@/lib/actions/listings";
import { absoluteUrl } from "@/lib/app-url";
import type { StorefrontListingDetail } from "@/lib/marketplace/contracts";
import {
  getStorefrontCatalog,
  getStorefrontListingBySlug,
  getStorefrontSlugs,
} from "@/lib/marketplace/storefront";
import { getResolvedWebSettings } from "@/lib/marketplace/web-settings-server";
import {
  BRAND_OG_IMAGE,
  listingMetaDescription,
  listingMetaTitle,
  listingOgImageUrl,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  pickSimilarListings,
} from "@/lib/marketplace/widget-quote";

/**
 * Ficha pública de una unidad (/u/[slug]).
 *
 * ISR: se regenera cada 5 minutos (y al revalidar el tag del catálogo desde el
 * panel). El server NO lee cookies ni searchParams: `?checkin&checkout&
 * huespedes&error` los lee el cliente (ListingStayProvider) y las noches
 * ocupadas se piden desde el widget con getUnitBlockedDates.
 */
export const revalidate = 300;
export const dynamicParams = true;

type Params = Promise<{ slug: string }>;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const slugs = await getStorefrontSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch {
    // Sin base en el build: las fichas se generan en el primer pedido.
    return [];
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getStorefrontListingBySlug(slug);
  if (!listing) return { title: "Lugar no encontrado", robots: { index: false } };

  const title = listingMetaTitle(listing);
  const description = listingMetaDescription(listing);
  const url = absoluteUrl(`/u/${listing.slug}`);
  // La portada recortada a 1200×630 por Supabase (el original pesa hasta 2 MB
  // y WhatsApp no arma la vista previa). Sin portada, la imagen de marca: el
  // openGraph de la ficha reemplaza entero al del layout, no hereda su imagen.
  const ogCover = listingOgImageUrl(listing.cover_url);
  const image = ogCover
    ? {
        url: ogCover,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: `${listing.display_title}, ${listing.summary_line}`,
      }
    : BRAND_OG_IMAGE;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "es_AR",
      siteName: "apart",
      url,
      title: `${title} · apart`,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · apart`,
      description,
      images: [image],
    },
  };
}

/** Lo mínimo de la ficha que viaja al cliente para el widget. */
function toStayListing(l: StorefrontListingDetail): StayListing {
  return {
    id: l.id,
    slug: l.slug,
    hood: l.hood,
    display_title: l.display_title,
    base_price: l.base_price,
    cleaning_fee: l.cleaning_fee,
    monthly_price: l.monthly_price,
    marketplace_currency: l.marketplace_currency,
    instant_book: l.instant_book,
    default_mode: l.default_mode,
    min_nights: l.min_nights,
    max_nights: l.max_nights,
    max_guests: l.max_guests,
    pricing_rules: l.pricing_rules,
  };
}

export default async function UnitPage({ params }: { params: Params }) {
  const { slug } = await params;
  const listing = await getStorefrontListingBySlug(slug);
  if (!listing) notFound();

  // Lo accesorio no tumba la ficha: sin reseñas, catálogo o comodidades se
  // muestra igual (en ISR queda la versión anterior si algo falla del todo).
  const [settings, reviews, amenityCatalog, catalog] = await Promise.all([
    getResolvedWebSettings(listing.organization_id),
    getReviewsForUnit(listing.id).catch(() => []),
    listMarketplaceAmenitiesCatalog().catch(() => []),
    getStorefrontCatalog().catch(() => null),
  ]);

  const codes = new Set(listing.amenities);
  const amenities: AmenityItem[] = amenityCatalog
    .filter((a) => codes.has(a.code))
    .map((a) => ({ code: a.code, name: a.name, icon: a.icon, category: a.category }));

  const similar = catalog ? pickSimilarListings(catalog.listings, listing, 4) : { items: [], sameHoodOnly: false };
  const similarTitle =
    similar.sameHoodOnly && listing.hood ? `Otros lugares en ${listing.hood}` : "Otros lugares que te pueden gustar";

  const pageUrl = absoluteUrl(`/u/${listing.slug}`);
  const staySettings: StaySettings = {
    responseHours: settings.responseHours,
    deposit: { rule: settings.deposit.rule, percent: settings.deposit.percent },
    whatsappNumber: settings.whatsappNumber,
    publicEmail: settings.publicEmail,
  };

  return (
    <ListingStayProvider key={listing.id} listing={toStayListing(listing)} settings={staySettings} pageUrl={pageUrl}>
      <ListingJsonLd listing={listing} amenityNames={amenities.map((a) => a.name)} />
      <ListingWhatsAppTopic />
      {/* Celular (< md): la galería va primera y a sangre (order, sin duplicarla)
          y el bloque del título es una hoja que sube sobre su borde de abajo.
          Todo con max-md:, así que desde md el orden y los márgenes son los de siempre. */}
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 max-md:flex max-md:flex-col max-md:pt-0 sm:px-6 md:pt-6 lg:px-8 lg:pb-20">
        <div className="max-md:relative max-md:z-10 max-md:-mt-6 max-md:rounded-t-[1.75rem] max-md:bg-cream max-md:pt-6 max-md:shadow-[0_-14px_28px_-18px_rgb(6_32_27/0.45)] max-sm:-mx-4 max-sm:px-4 sm:max-md:-mx-6 sm:max-md:px-6">
          <ListingErrorBanner />
          <ListingHeader listing={listing} pageUrl={pageUrl} />
        </div>
        <UnitGallery
          photos={listing.photos}
          title={listing.display_title}
          className="max-md:order-first md:mt-8"
          overlay={
            <>
              <BackLink variant="overlay" />
              <ListingShareActions variant="overlay" url={pageUrl} title={listing.display_title} unitId={listing.id} />
            </>
          }
        />

        <div className="mt-8 grid grid-cols-1 gap-10 md:mt-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14 xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-16">
          <div className="min-w-0">
            <UnitDetailInfo
              listing={listing}
              amenities={amenities}
              reviews={reviews}
              settings={{ responseHours: settings.responseHours, cancellationText: settings.cancellationText }}
            />
          </div>
          <aside className="hidden lg:block" aria-label="Reserva">
            <div className="sticky top-24">
              <UnitBookingWidget />
            </div>
          </aside>
        </div>

        {similar.items.length > 0 ? (
          <div className="mt-14 max-md:mt-10 md:mt-20">
            <SimilarListings items={similar.items} title={similarTitle} />
          </div>
        ) : null}
      </div>
      <MobileReserveBar />
    </ListingStayProvider>
  );
}
