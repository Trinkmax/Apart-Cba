"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Heart, Star, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatInCurrency } from "@/lib/marketplace/currency-config";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import { useT } from "@/lib/i18n/use-t";
import { toggleWishlist } from "@/lib/actions/wishlists";
import type { MarketplaceListingSummary } from "@/lib/types/database";

type Props = {
  listing: MarketplaceListingSummary;
  isFavorited?: boolean;
  priority?: boolean;
  href?: string;
};

export function ListingCard({ listing, isFavorited = false, priority = false, href }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  // Montaje progresivo del carrusel: al render inicial sólo la foto 0 pide
  // red; las siguientes se montan (y precargan eager) recién cuando el usuario
  // muestra intención (hover/touch) o navega. Evita 5 requests por card.
  const [mountedUpTo, setMountedUpTo] = useState(0);
  const [favorited, setFavorited] = useState(isFavorited);
  const [, startTransition] = useTransition();
  const { currency, locale } = useMarketplacePrefs();
  const t = useT();

  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const photos = listing.photo_urls.length > 0 ? listing.photo_urls : [listing.cover_url].filter(Boolean) as string[];
  const target = href ?? `/u/${listing.slug}`;
  const dotCount = Math.min(photos.length, 5);
  const isMensual = listing.default_mode === "mensual";

  function warmUpTo(index: number) {
    setMountedUpTo((m) => Math.max(m, Math.min(index, photos.length - 1)));
  }

  function handleScroll() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      warmUpTo(next + 1);
      setPhotoIndex((prev) => (prev === next ? prev : next));
    });
  }

  function scrollToSlide(i: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    warmUpTo(i + 1);
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  function scrollByDir(dir: -1 | 1, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = trackRef.current;
    if (!el) return;
    const next = Math.min(Math.max(photoIndex + dir, 0), photos.length - 1);
    warmUpTo(next + 1);
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  function handleFavoriteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !favorited;
    setFavorited(next);
    startTransition(async () => {
      const result = await toggleWishlist(listing.id);
      if (!result.ok) {
        setFavorited(!next);
        if (result.error?.toLowerCase().includes("sesión") || result.error?.toLowerCase().includes("inicia")) {
          toast.info("Iniciá sesión para guardar favoritos");
        } else {
          toast.error(result.error ?? "No se pudo guardar");
        }
      }
    });
  }

  const location = listing.neighborhood || listing.address || listing.city || "";

  return (
    <Link href={target} className="group block">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-neutral-100">
        {photos.length > 0 ? (
          <div
            ref={trackRef}
            onScroll={handleScroll}
            onPointerEnter={() => warmUpTo(1)}
            onTouchStart={() => warmUpTo(1)}
            className="no-scrollbar absolute inset-0 flex overflow-x-auto snap-x snap-mandatory"
          >
            {photos.map((src, i) => (
              <div key={i} className="relative w-full shrink-0 snap-start bg-neutral-100">
                {i <= mountedUpTo ? (
                  <Image
                    src={src}
                    alt={listing.marketplace_title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    priority={i === 0 ? priority : undefined}
                    // Los slides > 0 se montan justo para precargar: eager,
                    // así el swipe siguiente ya tiene la foto lista.
                    loading={i > 0 ? "eager" : undefined}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-neutral-400">Sin foto</div>
        )}

        {/* Desktop hover arrows */}
        {photos.length > 1 ? (
          <>
            <button
              type="button"
              onClick={(e) => scrollByDir(-1, e)}
              aria-label="Foto anterior"
              className="absolute left-2 top-1/2 z-10 hidden -translate-y-1/2 md:flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white disabled:opacity-0"
              disabled={photoIndex === 0}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={(e) => scrollByDir(1, e)}
              aria-label="Foto siguiente"
              className="absolute right-2 top-1/2 z-10 hidden -translate-y-1/2 md:flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white disabled:opacity-0"
              disabled={photoIndex === photos.length - 1}
            >
              <ChevronRight size={18} />
            </button>
          </>
        ) : null}

        {/* Photo dots */}
        {photos.length > 1 ? (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
            {Array.from({ length: dotCount }).map((_, i) => (
              <button
                type="button"
                key={i}
                onClick={(e) => scrollToSlide(i, e)}
                aria-label={`Ir a la foto ${i + 1}`}
                aria-current={i === photoIndex}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === photoIndex ? "w-4 bg-white" : "w-1.5 bg-white/60"
                )}
              />
            ))}
          </div>
        ) : null}

        {/* Wishlist heart */}
        <button
          onClick={handleFavoriteClick}
          aria-label={favorited ? "Quitar de favoritos" : "Guardar"}
          className="absolute top-3 right-3 z-10 p-1 group/heart"
        >
          <Heart
            size={26}
            className={cn(
              "drop-shadow-md transition-all",
              favorited
                ? "fill-sage-500 stroke-white stroke-[1.5px]"
                : "fill-black/30 stroke-white group-hover/heart:scale-110"
            )}
          />
        </button>

        {/* Badge: mensual gana sobre instant book (a un inquilino mensual no
            le hablamos de "reserva al toque") */}
        {isMensual ? (
          <div className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm">
            <CalendarRange size={11} className="text-sage-600" />
            {t("card.badge_mensual")}
          </div>
        ) : listing.instant_book ? (
          <div className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm">
            <Zap size={11} className="text-yellow-500 fill-yellow-500" />
            Reserva al toque
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium text-sm text-neutral-900 line-clamp-1">
            {location || listing.marketplace_title}
          </div>
          {listing.rating_count > 0 ? (
            <div className="flex items-center gap-1 shrink-0 text-sm">
              <Star size={12} className="fill-neutral-900 stroke-neutral-900" />
              <span className="font-medium">{listing.rating_avg.toFixed(2)}</span>
            </div>
          ) : (
            <div className="text-xs text-neutral-500 shrink-0">Sin reseñas aún</div>
          )}
        </div>
        <div className="text-sm text-neutral-500 line-clamp-1">{listing.marketplace_title}</div>
        <div className="text-sm text-neutral-500">
          {listing.bedrooms ? `${listing.bedrooms} ${listing.bedrooms === 1 ? "ambiente" : "ambientes"}` : null}
          {listing.max_guests ? ` · hasta ${listing.max_guests} huéspedes` : null}
        </div>
        <div className="pt-1">
          <span className="font-semibold text-neutral-900">
            {/* Unidades de vocación mensual: estimado por mes (base × 30),
                que es lo que costarían 30 noches a precio base. */}
            {isMensual ? "≈ " : ""}
            {formatInCurrency(
              isMensual ? listing.base_price * 30 : listing.base_price,
              listing.marketplace_currency,
              currency,
              locale
            )}
          </span>
          <span className="text-sm text-neutral-500">
            {" "}
            {t(isMensual ? "featured.per_month" : "featured.per_night")}
          </span>
        </div>
        {!isMensual && listing.min_nights > 1 ? (
          <div className="text-xs text-neutral-500">
            Mínimo {listing.min_nights} noches
          </div>
        ) : null}
      </div>
    </Link>
  );
}
