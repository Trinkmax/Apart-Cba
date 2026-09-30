"use client";

import { useLayoutEffect } from "react";
import { ListingCard } from "@/components/marketplace/listing-card";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import { seedWishlist } from "./use-wishlist";

/**
 * Grilla de /favoritos. Las tarjetas quedan aunque se quite el corazón (se
 * puede volver a guardar sin perderla de vista); al recargar ya no aparecen.
 */
export function FavoritesGrid({ listings }: { listings: CatalogListing[] }) {
  useLayoutEffect(() => {
    seedWishlist(listings.map((l) => l.id));
  }, [listings]);

  return (
    <ul className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listings.map((listing, i) => (
        <li key={listing.id}>
          <ListingCard
            listing={listing}
            view={listing.offers_short ? "noche" : "mes"}
            priority={i < 4}
          />
        </li>
      ))}
    </ul>
  );
}
