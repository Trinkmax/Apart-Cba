import { absoluteUrl, getAppUrl } from "@/lib/app-url";
import type { StorefrontListingDetail } from "@/lib/marketplace/contracts";
import { headlinePrice } from "@/lib/marketplace/stay";
import { listingMetaDescription } from "@/lib/marketplace/widget-quote";

/**
 * Datos estructurados de la ficha: el departamento (Apartment) y apart
 * (LodgingBusiness) que lo ofrece (Offer en ARS, por noche o por mes). Sin
 * dirección exacta: se comparte recién al confirmar.
 */
export function ListingJsonLd({
  listing,
  amenityNames,
}: {
  listing: StorefrontListingDetail;
  amenityNames: string[];
}) {
  const pageUrl = absoluteUrl(`/u/${listing.slug}`);
  const siteUrl = getAppUrl();
  const images = listing.photos
    .filter((p) => p.media_type === "image")
    .slice(0, 6)
    .map((p) => p.public_url);
  if (images.length === 0 && listing.cover_url) images.push(listing.cover_url);

  const apartment: Record<string, unknown> = {
    "@type": "Apartment",
    "@id": `${pageUrl}#depto`,
    name: listing.display_title,
    description: listingMetaDescription(listing),
    url: pageUrl,
    image: images.length ? images : undefined,
    numberOfBedrooms: listing.bedrooms ?? undefined,
    numberOfBathroomsTotal: listing.bathrooms ?? undefined,
    numberOfRooms: listing.bedrooms != null ? Math.max(1, Number(listing.bedrooms) + 1) : undefined,
    occupancy: listing.max_guests ? { "@type": "QuantitativeValue", maxValue: listing.max_guests } : undefined,
    floorSize: listing.size_m2 ? { "@type": "QuantitativeValue", value: Number(listing.size_m2), unitCode: "MTK" } : undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.city ?? "Córdoba",
      addressRegion: "Córdoba",
      addressCountry: "AR",
    },
    geo:
      listing.latitude != null && listing.longitude != null
        ? { "@type": "GeoCoordinates", latitude: listing.latitude, longitude: listing.longitude }
        : undefined,
    amenityFeature: amenityNames.length
      ? amenityNames.map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true }))
      : undefined,
  };

  const hp = headlinePrice(listing, listing.offers_short ? "noche" : "mes");
  // La web cobra en pesos; la moneda de la unidad es ARS salvo carga manual distinta.
  const currency = (listing.marketplace_currency || "ARS").toUpperCase();
  const business: Record<string, unknown> = {
    "@type": "LodgingBusiness",
    "@id": `${siteUrl}/#apart`,
    name: "apart",
    url: siteUrl,
    address: { "@type": "PostalAddress", addressLocality: "Córdoba", addressRegion: "Córdoba", addressCountry: "AR" },
    makesOffer:
      hp.kind === "amount"
        ? {
            "@type": "Offer",
            url: pageUrl,
            price: hp.amount,
            priceCurrency: currency,
            availability: "https://schema.org/InStock",
            itemOffered: { "@id": `${pageUrl}#depto` },
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: hp.amount,
              priceCurrency: currency,
              unitText: hp.per === "mes" ? "mes" : "noche",
              unitCode: hp.per === "mes" ? "MON" : "DAY",
            },
          }
        : undefined,
  };

  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": [apartment, business] }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
