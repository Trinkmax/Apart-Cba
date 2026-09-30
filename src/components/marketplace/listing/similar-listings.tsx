"use client";

import { ListingCard } from "@/components/marketplace/listing-card";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import { useListingStay } from "./stay-context";

/**
 * "Otros lugares en {barrio}" (4 tarjetas). Si el huésped ya eligió fechas
 * por noche, los links las llevan (así no las vuelve a cargar).
 */
export function SimilarListings({ items, title }: { items: CatalogListing[]; title: string }) {
  const { view, checkIn, checkOut, guests } = useListingStay();
  if (items.length === 0) return null;
  const stay = view === "noche" && checkIn && checkOut && checkOut > checkIn ? { checkIn, checkOut, guests } : null;

  return (
    <section aria-labelledby="otros-lugares-title" className="border-t border-cream-300 pt-10 md:pt-14">
      <div id="otros-lugares-title">
        <SectionHeading as="h2" title={title} accent="Hay lugares que conectan personas." />
      </div>
      <ul className="mt-8 grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((l) => (
          <li key={l.id}>
            <ListingCard listing={l} view={l.offers_short ? "noche" : "mes"} stay={l.offers_short ? stay : null} />
          </li>
        ))}
      </ul>
    </section>
  );
}
