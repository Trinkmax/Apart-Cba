"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import { cardPrice, listingHref, nightsLabel } from "@/lib/marketplace/catalog-filter";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { bedroomsLabel, guestsLabel } from "@/lib/marketplace/display";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { HeartButton } from "@/components/marketplace/wishlist/heart-button";

export type ListingCardProps = {
  listing: CatalogListing;
  /** Qué precio mostrar (headlinePrice): por noche o por mes. */
  view?: "noche" | "mes";
  /** Fechas de la búsqueda: arman el link y el total. */
  stay?: { checkIn: string; checkOut: string; guests?: number } | null;
  /** next/image priority (las primeras 4 de una grilla). */
  priority?: boolean;
  /**
   * La tarjeta va en un riel horizontal (home, "Otros lugares"). Sólo por
   * debajo de lg: una sola foto (el deslizamiento mueve el riel, no el
   * carrusel de fotos de adentro), sin puntos ni flechas, y `sizes` al ancho
   * del riel (80 %). Desde lg no cambia nada.
   */
  rail?: boolean;
  /**
   * false: por debajo de lg se esconde la etiqueta "Por mes" de la foto (en
   * /buscar por mes todas lo son y el precio ya dice "mes"). Desde lg, igual.
   */
  mobileBadge?: boolean;
  className?: string;
};

// Desde lg (las dos últimas condiciones) tiene que quedar igual en las dos:
// el escritorio baja la misma foto.
const SIZES = "(max-width: 639px) 92vw, (max-width: 1023px) 46vw, (max-width: 1279px) 30vw, 22vw";
const RAIL_SIZES = "(max-width: 639px) 80vw, (max-width: 1023px) 22rem, (max-width: 1279px) 30vw, 22vw";
/**
 * Dentro de un riel horizontal, por debajo de lg, se ve una sola foto: el gesto
 * de deslizar es del riel y no del carrusel de adentro (dos scrolls
 * horizontales anidados se pelean). Se detecta solo: un ancestro con
 * `overflow-x-auto` en sus clases (SnapRail / MOBILE_RAIL usan
 * `max-lg:overflow-x-auto`). La prop `rail` lo fuerza y además ajusta `sizes`.
 * Todo con `max-lg:`: desde lg no hace nada.
 */
const IN_RAIL_TRACK = "in-[[class*=overflow-x-auto]]:max-lg:overflow-x-hidden";
const IN_RAIL_DOTS = "in-[[class*=overflow-x-auto]]:max-lg:hidden";
const IN_RAIL_ARROW = "in-[[class*=overflow-x-auto]]:md:max-lg:hidden";
const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * Tarjeta de un alojamiento. Todo el bloque es un link a la ficha; el corazón
 * y las flechas del carrusel viven ENCIMA como hermanos del link (nunca un
 * botón adentro de un <a>), así que no navegan.
 */
export function ListingCard({
  listing,
  view = "noche",
  stay = null,
  priority = false,
  rail = false,
  mobileBadge = true,
  className,
}: ListingCardProps) {
  const photos = listing.photo_urls.length > 0 ? listing.photo_urls : listing.cover_url ? [listing.cover_url] : [];
  const [index, setIndex] = useState(0);
  // Carga progresiva: al principio sólo la foto 0 pide red; las siguientes se
  // montan (eager) recién cuando hay intención (hover, toque, swipe, flecha).
  const [mountedUpTo, setMountedUpTo] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const href = listingHref(listing.slug, stay);
  const price = cardPrice(listing, view, stay);
  const perMonth = view === "mes" ? listing.offers_monthly : !listing.offers_short;
  const capacity = [bedroomsLabel(listing.bedrooms), guestsLabel(listing.max_guests)].filter(Boolean).join(" · ");
  const place = listing.hood ?? listing.city ?? "Córdoba";
  const showMinNights = view === "noche" && listing.offers_short && listing.min_nights > 2;

  function warmUpTo(i: number) {
    // En un riel (< lg) la pista no se desliza y se ve sólo la primera foto: no pedir las demás.
    const track = trackRef.current;
    if (track && getComputedStyle(track).overflowX === "hidden") return;
    setMountedUpTo((m) => Math.max(m, Math.min(i, photos.length - 1)));
  }

  function handleScroll() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      warmUpTo(next + 1);
      setIndex((prev) => (prev === next ? prev : next));
    });
  }

  function go(dir: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    const next = Math.min(Math.max(index + dir, 0), photos.length - 1);
    warmUpTo(next + 1);
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  return (
    <article
      className={cn(
        "group/card relative transition-transform duration-300 motion-safe:hover:-translate-y-0.5",
        EASE,
        className,
      )}
    >
      <Link
        href={href}
        className="block rounded-3xl outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 focus-visible:ring-offset-4 focus-visible:ring-offset-cream"
      >
        <div
          className={cn(
            "relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-cream-200 shadow-apart-sm transition-shadow duration-300",
            "group-hover/card:shadow-apart-md",
          )}
        >
          {photos.length > 0 ? (
            <div
              ref={trackRef}
              onScroll={handleScroll}
              onPointerEnter={() => warmUpTo(1)}
              onTouchStart={() => warmUpTo(1)}
              className={cn(
                "no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
                // En un riel (< lg) el carrusel de adentro no se desliza: el gesto es del riel.
                IN_RAIL_TRACK,
                rail && "max-lg:overflow-x-hidden",
              )}
            >
              {photos.map((src, i) => (
                <div key={`${src}-${i}`} className="relative h-full w-full shrink-0 snap-start snap-always">
                  {i <= mountedUpTo ? (
                    <Image
                      src={src}
                      alt={i === 0 ? `Foto de ${listing.display_title}` : ""}
                      fill
                      sizes={rail ? RAIL_SIZES : SIZES}
                      priority={i === 0 && priority}
                      loading={i > 0 ? "eager" : undefined}
                      draggable={false}
                      className={cn(
                        "object-cover transition-transform duration-700 motion-safe:group-hover/card:scale-[1.03]",
                        EASE,
                      )}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-leaf-100">
              <ApartLogo variant="symbol" title={null} className="h-12 text-leaf-400" />
            </div>
          )}

          {perMonth ? (
            <span
              className={cn(
                "absolute left-3 top-3 z-[1] inline-flex items-center gap-1.5 rounded-full bg-paper/95 px-2.5 py-1 text-xs font-bold text-forest-700 shadow-apart-sm",
                !mobileBadge && "max-lg:hidden",
              )}
            >
              <CalendarRange aria-hidden className="size-3.5" />
              Por mes
            </span>
          ) : listing.instant_book ? (
            <span className="absolute left-3 top-3 z-[1] inline-flex items-center gap-1.5 rounded-full bg-forest-700 px-2.5 py-1 text-xs font-bold text-cream shadow-apart-sm">
              <Zap aria-hidden className="size-3.5 fill-leaf-300 stroke-leaf-300" />
              Reserva inmediata
            </span>
          ) : null}

          {photos.length > 1 ? (
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 bottom-3 z-[1] flex justify-center gap-1.5",
                IN_RAIL_DOTS,
                rail && "max-lg:hidden",
              )}
            >
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full bg-paper shadow-[0_0_2px_rgb(6_32_27/0.4)] transition-all duration-300",
                    i === index ? "w-4 opacity-100" : "w-1.5 opacity-60",
                  )}
                />
              ))}
            </span>
          ) : null}
        </div>

        <div className="mt-3.5 px-1">
          <p className="text-[0.8125rem] font-medium text-ink-500">{place}</p>
          <h3 className="mt-0.5 line-clamp-1 font-apart text-[1.0625rem] font-bold leading-snug tracking-[-0.01em] text-forest-700">
            {listing.display_title}
            {listing.display_tagline ? (
              <span className="font-apart-serif text-[0.9375rem] font-normal italic text-ink-500">
                {" "}
                · {listing.display_tagline}
              </span>
            ) : null}
          </h3>
          {capacity ? <p className="mt-0.5 text-sm text-ink-600">{capacity}</p> : null}
          <CardPriceLine price={price} />
          {showMinNights ? (
            <p className="mt-0.5 text-[0.8125rem] text-ink-500">Mínimo {nightsLabel(listing.min_nights)}</p>
          ) : null}
        </div>
      </Link>

      {/* Encima del link (hermanos, no hijos): corazón y flechas. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/3]">
        <HeartButton unitId={listing.id} className="pointer-events-auto absolute right-1.5 top-1.5 z-[2]" />
        {photos.length > 1 ? (
          <>
            <CarouselArrow dir={-1} hidden={index === 0} rail={rail} onClick={() => go(-1)} />
            <CarouselArrow dir={1} hidden={index >= photos.length - 1} rail={rail} onClick={() => go(1)} />
          </>
        ) : null}
      </div>
    </article>
  );
}

function CardPriceLine({ price }: { price: ReturnType<typeof cardPrice> }) {
  if (price.kind === "consult") {
    return <p className="mt-2 text-[0.9375rem] font-semibold text-forest-700">Precio a consultar</p>;
  }
  if (price.kind === "total") {
    return (
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[0.9375rem] text-ink-700">
        <span>
          <span className="font-bold tabular-nums text-ink-900">{formatCurrency(price.total, price.currency)}</span>{" "}
          total · {nightsLabel(price.nights)}
        </span>
        <span className="text-[0.8125rem] tabular-nums text-ink-500">
          {formatCurrency(price.nightly, price.currency)} noche
        </span>
      </p>
    );
  }
  return (
    <p className="mt-2 text-[0.9375rem] text-ink-700">
      <span className="font-bold tabular-nums text-ink-900">{formatCurrency(price.amount, price.currency)}</span>{" "}
      {price.per}
    </p>
  );
}

function CarouselArrow({
  dir,
  hidden,
  rail,
  onClick,
}: {
  dir: -1 | 1;
  hidden: boolean;
  rail: boolean;
  onClick: () => void;
}) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={dir < 0 ? "Foto anterior" : "Foto siguiente"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "pointer-events-auto absolute top-1/2 z-[2] hidden size-8 -translate-y-1/2 place-items-center rounded-full",
        "bg-paper/95 text-forest-700 shadow-apart-md transition-opacity duration-200 hover:bg-paper md:grid",
        "opacity-0 group-hover/card:opacity-100",
        dir < 0 ? "left-3" : "right-3",
        hidden && "invisible",
        // En un riel se ve una sola foto hasta lg (md:grid las mostraría desde 768 px).
        IN_RAIL_ARROW,
        rail && "md:max-lg:hidden",
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2.5} />
    </button>
  );
}

/** Lugar reservado para una tarjeta mientras carga (misma geometría). */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("motion-safe:animate-pulse", className)}>
      <div className="aspect-[4/3] w-full rounded-3xl bg-cream-200" />
      <div className="mt-3.5 space-y-2 px-1">
        <div className="h-3 w-24 rounded-full bg-cream-200" />
        <div className="h-4 w-40 rounded-full bg-cream-300/70" />
        <div className="h-3 w-32 rounded-full bg-cream-200" />
        <div className="h-4 w-28 rounded-full bg-cream-300/70" />
      </div>
    </div>
  );
}
