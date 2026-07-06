import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { UnitGallery } from "@/components/marketplace/unit-gallery";
import { UnitDetailInfo } from "@/components/marketplace/unit-detail-info";
import { UnitBookingWidget } from "@/components/marketplace/unit-booking-widget";
import { MobileReserveBar } from "@/components/marketplace/mobile-reserve-bar";
import { UnitLocationMap } from "@/components/marketplace/unit-location-map";
import { ListingShareActions } from "@/components/marketplace/listing-share-actions";
import {
  getListingBlockedDates,
  getReviewsForUnit,
} from "@/lib/actions/marketplace";
import { getListingBySlug } from "@/lib/marketplace/listing-reads";
import { todayIsoAR } from "@/lib/marketplace/pricing";
import { listMarketplaceAmenitiesCatalog } from "@/lib/actions/listings";
import { getGuestSession } from "@/lib/actions/guest-auth";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | undefined>>;

/**
 * `?huespedes=` puede venir malformado (ej. "abc"): parseInt daría NaN, que se
 * propaga al widget (muestra "NaN huésped") y al URL de checkout. Devolvemos
 * null salvo un entero positivo válido.
 */
function parseGuestsParam(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Mensajes que el checkout puede mandar por `?error=` (ver
 * checkUnitAvailability y checkout/[unitId]/page.tsx). Cualquier otro texto
 * se reemplaza por un genérico para que nadie use el banner como vector de
 * mensajes falsos vía links compartidos.
 */
const KNOWN_CHECKOUT_ERRORS = new Set<string>([
  "Las fechas son inválidas",
  "Esas fechas ya están reservadas",
  "Hay una solicitud pendiente para esas fechas. Probá con otras o esperá unas horas.",
  "No podés reservar fechas pasadas",
]);

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Alojamiento no encontrado · ApartCBA" };

  const title = `${listing.marketplace_title} · ApartCBA`;
  const description =
    listing.marketplace_description?.slice(0, 200) ??
    `Reservá ${listing.marketplace_title} en ApartCBA.`;
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.apartcba.com"}/u/${slug}`;
  const images = listing.cover_url ? [{ url: listing.cover_url }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: listing.cover_url ? [listing.cover_url] : undefined,
    },
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

  // "Hoy" en horario argentino, igual que el widget y el piso del checkout.
  // Con UTC, de 21:00 a 24:00 AR la ventana arrancaba "mañana" y la noche de
  // hoy ocupada se mostraba libre en el calendario.
  const today = todayIsoAR();
  const toIso = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() + 12);
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
        <ListingShareActions
          slug={listing.slug}
          title={listing.marketplace_title}
          unitId={listing.id}
        />
      </div>

      {/* El checkout redirige acá con ?error= cuando la disponibilidad cambió
          entre la selección y el pago (otro huésped ganó las fechas). Sin este
          banner el usuario volvía a la página sin ninguna explicación.
          Sólo se refleja texto de la whitelist: el param viene por URL y un
          link armado podría poner cualquier cosa dentro de un banner "oficial". */}
      {sp.error ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            {KNOWN_CHECKOUT_ERRORS.has(sp.error)
              ? sp.error
              : "No pudimos completar la reserva con esas fechas. Verificá la disponibilidad e intentá de nuevo."}
          </div>
        </div>
      ) : null}

      {/* Gallery */}
      <div className="relative">
        <UnitGallery photos={listing.photos} title={listing.marketplace_title} />
      </div>

      {/* Two-column layout. pb extra en mobile: la MobileReserveBar fija abajo
          no debe tapar el final del contenido. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 lg:gap-12 mt-8 md:mt-12 pb-28 lg:pb-12">
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
        <aside id="booking-widget" className="lg:sticky lg:top-28 self-start scroll-mt-24">
          <UnitBookingWidget
            listing={listing}
            blockedDates={blockedDates}
            isAuthenticated={Boolean(session)}
            prefillCheckIn={sp.checkin ?? null}
            prefillCheckOut={sp.checkout ?? null}
            prefillGuests={parseGuestsParam(sp.huespedes)}
          />
        </aside>
      </div>

      <MobileReserveBar listing={listing} />
    </div>
  );
}
