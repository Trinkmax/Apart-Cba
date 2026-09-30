import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Reveal } from "@/components/marketplace/reveal";
import type { CatalogListing } from "@/lib/marketplace/contracts";

/**
 * "Lugares para quedarte": ocho unidades que aceptan estadías cortas,
 * variadas por barrio (pickFeaturedListings). Carrusel con snap en mobile,
 * grilla de 4 columnas en desktop.
 */
export function HomeFeatured({ listings, total }: { listings: CatalogListing[]; total: number }) {
  if (listings.length === 0) return null;
  // El link abre la pestaña "Por noches": el número tiene que ser el que se va a ver ahí.
  const cta = total > 1 ? `Ver los ${total} para estadías cortas` : "Ver alojamientos";

  return (
    <section className="py-14 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <Reveal className="flex items-end justify-between gap-6">
          <SectionHeading eyebrow="Alojamientos" title="Lugares para quedarte" accent="Sentite como en casa." />
          <Link
            href="/buscar?modo=noche"
            className="group hidden min-h-11 shrink-0 items-center gap-1.5 text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700 md:inline-flex"
          >
            {cta}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </Reveal>
      </div>

      <ul
        aria-label="Algunos alojamientos"
        className={
          "mx-auto mt-8 flex max-w-[1320px] snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:mt-10 sm:scroll-px-6 sm:gap-5 sm:px-6 " +
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
          "lg:grid lg:snap-none lg:grid-cols-4 lg:gap-x-6 lg:gap-y-10 lg:overflow-visible lg:px-8 lg:pb-0"
        }
      >
        {listings.map((listing, i) => (
          <li key={listing.id} className="w-[80%] max-w-[22rem] shrink-0 snap-start sm:w-[46%] lg:w-auto lg:max-w-none">
            <Reveal delay={Math.min(i, 3) * 80} y={16}>
              <ListingCard listing={listing} view="noche" />
            </Reveal>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex justify-center px-4 md:hidden">
        <ApartButton asChild variant="secondary" size="lg" className="w-full max-w-sm">
          <Link href="/buscar?modo=noche">
            {cta}
            <ArrowRight aria-hidden />
          </Link>
        </ApartButton>
      </div>
    </section>
  );
}
