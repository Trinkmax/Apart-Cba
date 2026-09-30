"use client";

import { ListingCard } from "@/components/marketplace/listing-card";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { SnapRail } from "@/components/marketplace/brand/snap-rail";
import { MOBILE_RAIL_ITEM } from "@/components/marketplace/brand/snap-rail-classes";
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
    <section aria-labelledby="otros-lugares-title" className="border-t border-cream-300 pt-10 max-md:pt-8 md:pt-14">
      <div id="otros-lugares-title">
        <SectionHeading as="h2" title={title} accent="Hay lugares que conectan personas." />
      </div>
      {/* Por debajo de lg, riel con snap y la tarjeta siguiente asomada (sube al
          entrar: m-rise); desde lg, la grilla de 4 de siempre. */}
      <SnapRail as="ul" label={title} className="m-rise mt-8 max-lg:mt-6 lg:grid lg:grid-cols-4 lg:gap-x-5 lg:gap-y-9">
        {items.map((l) => (
          <li key={l.id} className={MOBILE_RAIL_ITEM}>
            <ListingCard listing={l} view={l.offers_short ? "noche" : "mes"} stay={l.offers_short ? stay : null} rail />
          </li>
        ))}
      </SnapRail>
    </section>
  );
}
