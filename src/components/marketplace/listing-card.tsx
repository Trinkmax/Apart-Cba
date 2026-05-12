"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Heart, Star, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/marketplace/pricing";
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
  const [favorited, setFavorited] = useState(isFavorited);
  const [, startTransition] = useTransition();

  const photos = listing.photo_urls.length > 0 ? listing.photo_urls : [listing.cover_url].filter(Boolean) as string[];
  const target = href ?? `/u/${listing.slug}`;

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
          <Image
            src={photos[photoIndex] ?? photos[0]}
            alt={listing.marketplace_title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-neutral-400">Sin foto</div>
        )}

        {/* Photo dots */}
        {photos.length > 1 ? (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
            {photos.slice(0, 5).map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.preventDefault();
                  setPhotoIndex(i);
                }}
                aria-label={`Foto ${i + 1}`}
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
                ? "fill-rose-500 stroke-white stroke-[1.5px]"
                : "fill-black/30 stroke-white group-hover/heart:scale-110"
            )}
          />
        </button>

        {/* Instant book badge */}
        {listing.instant_book ? (
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
            {formatCurrency(listing.base_price, listing.marketplace_currency)}
          </span>
          <span className="text-sm text-neutral-500"> /noche</span>
        </div>
      </div>
    </Link>
  );
}
