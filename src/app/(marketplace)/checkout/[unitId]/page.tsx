import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getGuestSession } from "@/lib/actions/guest-auth";
import { checkUnitAvailability } from "@/lib/marketplace/availability";
import { cancellationCopy, checkInWindowLabel } from "@/lib/marketplace/display";
import { todayIsoAR } from "@/lib/marketplace/pricing";
import { computeSena, depositRuleLabel, restoAlLlegar } from "@/lib/marketplace/sena";
import { getStorefrontListingById } from "@/lib/marketplace/storefront";
import { getResolvedWebSettings } from "@/lib/marketplace/web-settings-server";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { CheckoutForm } from "@/components/marketplace/checkout-form";
import { BrandDot } from "@/components/marketplace/brand/brand-shapes";
import {
  availabilityRedirectCode,
  evaluateCheckoutStay,
  listingReturnPath,
} from "@/components/marketplace/reservation/checkout-guard";
import type { CheckoutSummaryData } from "@/components/marketplace/reservation/checkout-summary";

// Lee la sesión (opcional) y valida disponibilidad en cada visita.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pedí tu reserva",
  robots: { index: false, follow: false },
};

type Params = Promise<{ unitId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Checkout de la web (`/checkout/<unitId>?checkin&checkout&huespedes`). Antes
 * de mostrar el formulario valida la estadía en el servidor (fechas, mínimo y
 * máximo de noches, huéspedes, 28+ noches = consulta, disponibilidad): si algo
 * no da, vuelve a la ficha con el aviso correspondiente. No exige cuenta.
 */
export default async function CheckoutPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ unitId }, sp] = await Promise.all([params, searchParams]);

  const listing = await getStorefrontListingById(unitId);
  if (!listing) notFound();

  const stay = evaluateCheckoutStay({
    checkIn: sp.checkin,
    checkOut: sp.checkout,
    guests: sp.huespedes,
    todayIso: todayIsoAR(),
    listing,
  });
  if (!stay.ok) redirect(listingReturnPath(listing.slug, stay.keep, stay.code));

  const keep = { checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests };
  const [availability, settings, session] = await Promise.all([
    checkUnitAvailability({ unitId: listing.id, checkInIso: stay.checkIn, checkOutIso: stay.checkOut }).catch(
      (e: unknown) => {
        console.error("[checkout] disponibilidad:", e);
        return null;
      },
    ),
    getResolvedWebSettings(listing.organization_id),
    getGuestSession(),
  ]);
  if (availability && !availability.available) {
    // Un error de lectura no frena el checkout: submitCheckout vuelve a chequear.
    const code = availabilityRedirectCode(availability.reason);
    if (code) redirect(listingReturnPath(listing.slug, keep, code));
  }

  const currency = listing.marketplace_currency || "ARS";
  const { pricing } = stay;
  const sena = computeSena({
    policy: settings.deposit,
    nights: stay.nights,
    subtotal: pricing.subtotal,
    total: pricing.total,
    currency,
  });
  const prices = new Set(pricing.nights.map((n) => n.price));

  const summary: CheckoutSummaryData = {
    unit: {
      id: listing.id,
      slug: listing.slug,
      title: listing.display_title,
      tagline: listing.display_tagline,
      hood: listing.hood,
      summaryLine: listing.summary_line,
      coverUrl: listing.cover_url,
      instant: listing.instant_book,
    },
    stay: { checkIn: stay.checkIn, checkOut: stay.checkOut, nights: stay.nights, guests: stay.guests },
    money: {
      currency,
      subtotal: pricing.subtotal,
      cleaningFee: pricing.cleaning_fee,
      total: pricing.total,
      avgNightly: pricing.avg_price_per_night,
      variableNightly: prices.size > 1,
      sena,
      senaRuleLabel: sena ? depositRuleLabel(settings.deposit) : null,
      resto: restoAlLlegar(pricing.total, sena),
    },
    changeDatesHref: listingReturnPath(listing.slug, keep, null),
  };

  const profile = session?.profile ?? null;
  const guest = session
    ? {
        fullName: profile?.full_name ?? "",
        email: session.email,
        phone: profile?.phone ?? "",
        document: profile?.document_number ?? "",
      }
    : null;

  const selfPath = `/checkout/${listing.id}?checkin=${stay.checkIn}&checkout=${stay.checkOut}&huespedes=${stay.guests}`;
  const instant = listing.instant_book;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-40 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pb-24">
      <Link
        href={summary.changeDatesHref}
        className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-forest-700 outline-none hover:bg-forest-700/[0.06] focus-visible:ring-[3px] focus-visible:ring-forest-500/30"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Volver a {listing.display_title}
      </Link>
      <header className="mb-8 max-w-3xl sm:mb-10">
        <h1 className="font-apart text-[2rem] font-extrabold leading-[1.05] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.75rem]">
          {instant ? "Confirmá tu reserva" : "Pedí tu reserva"}
          <BrandDot />
        </h1>
        <p className="mt-3 font-apart-serif text-lg italic leading-snug text-forest-600 sm:text-xl">
          {instant
            ? "Queda confirmada al instante. Todavía no pagás nada."
            : `Te confirmamos en menos de ${hoursLabel(settings.responseHours)}. Todavía no pagás nada.`}
        </p>
      </header>
      <CheckoutForm
        summary={summary}
        responseHours={settings.responseHours}
        houseRules={listing.house_rules}
        checkInWindow={checkInWindowLabel(listing.check_in_window_start, listing.check_in_window_end)}
        cancellation={cancellationCopy(listing.cancellation_policy, settings.cancellationText)}
        guest={guest}
        signInHref={`/ingresar?redirect=${encodeURIComponent(selfPath)}`}
      />
    </div>
  );
}
