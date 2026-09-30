import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { SnapRail } from "@/components/marketplace/brand/snap-rail";
import { MOBILE_RAIL_ITEM } from "@/components/marketplace/brand/snap-rail-classes";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Reveal } from "@/components/marketplace/reveal";
import { cn } from "@/lib/utils";
import type { CatalogListing } from "@/lib/marketplace/contracts";

/**
 * Zoom de las fotos de las tarjetas cuando el riel entra en pantalla (sólo < lg,
 * con animaciones por scroll y sin "reducir movimiento"). `.m-zoom-in` no sirve
 * adentro del riel (su `view()` tomaría el propio riel, que scrollea en
 * horizontal): el riel publica una línea de tiempo con nombre y las fotos de
 * cada tarjeta se atan a esa.
 */
const RAIL_TIMELINE = "max-lg:[view-timeline-name:--home-featured]";
const PHOTO_ZOOM =
  "max-lg:motion-safe:supports-[animation-timeline:view()]:[&_img]:animate-[m-zoom-in_linear_both] " +
  "max-lg:motion-safe:supports-[animation-timeline:view()]:[&_img]:[animation-timeline:--home-featured] " +
  "max-lg:motion-safe:supports-[animation-timeline:view()]:[&_img]:[animation-range:entry_0%_cover_45%]";

/**
 * "Lugares para quedarte": ocho unidades que aceptan estadías cortas,
 * variadas por barrio (pickFeaturedListings). Celular y tablet: riel con snap
 * y barra de progreso (SnapRail); desktop: grilla de 4 columnas.
 */
export function HomeFeatured({ listings, total }: { listings: CatalogListing[]; total: number }) {
  if (listings.length === 0) return null;
  // El link abre la pestaña "Por noches": el número tiene que ser el que se va a ver ahí.
  const cta = total > 1 ? `Ver los ${total} para estadías cortas` : "Ver alojamientos";

  return (
    <section className="py-10 sm:py-14 lg:py-24">
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

      <SnapRail
        as="ul"
        label="Algunos alojamientos"
        // Teléfono: la barra a la izquierda y "Ver los N" a la derecha, en la misma línea.
        progressClassName="max-md:ml-4 sm:max-md:ml-6"
        className={cn(
          // < lg: el ul ya ocupa todo el ancho de la sección, así que va sin los
          // márgenes negativos del riel (con el mismo padding de página).
          "max-sm:mx-0 sm:max-lg:mx-0",
          // ≥ lg: lo mismo que antes (grilla de 4, gap-x-6 / gap-y-10, px-8, mt-10).
          "mx-auto mt-6 max-w-[1320px] sm:mt-8 lg:mt-10 lg:grid lg:grid-cols-4 lg:gap-x-6 lg:gap-y-10 lg:px-8",
          RAIL_TIMELINE,
        )}
      >
        {listings.map((listing, i) => (
          <li key={listing.id} className={cn(MOBILE_RAIL_ITEM, "sm:max-lg:w-[46%]", PHOTO_ZOOM)}>
            <Reveal delay={Math.min(i, 3) * 80} y={16}>
              <ListingCard listing={listing} view="noche" rail />
            </Reveal>
          </li>
        ))}
      </SnapRail>

      {/* < md (desde md está el link del encabezado): sube a la línea de la barra de progreso. */}
      <Link
        href="/buscar?modo=noche"
        className="group -mt-6 ml-auto mr-2 flex min-h-11 w-fit items-center gap-1.5 px-2 text-sm font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700 sm:mr-4 md:hidden"
      >
        {total > 1 ? (
          <span>
            Ver los {total}
            <span className="sr-only"> para estadías cortas</span>
          </span>
        ) : (
          cta
        )}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}
