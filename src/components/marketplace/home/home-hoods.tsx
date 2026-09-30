import Image from "next/image";
import Link from "next/link";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { SnapRail } from "@/components/marketplace/brand/snap-rail";
import { Reveal } from "@/components/marketplace/reveal";
import { cn } from "@/lib/utils";
import { deptosLabel, type HoodTile } from "./home-data";

/**
 * Zoom de las fotos cuando el riel entra en pantalla (sólo < lg, con animaciones
 * por scroll y sin "reducir movimiento"). `.m-zoom-in` no sirve adentro de un
 * riel: su `view()` toma el contenedor con scroll más cercano, que es el propio
 * riel (horizontal), y la animación queda quieta. Por eso el riel publica una
 * línea de tiempo con nombre y cada foto se ata a esa.
 */
const RAIL_TIMELINE = "max-lg:[view-timeline-name:--home-hoods]";
const PHOTO_ZOOM =
  "max-lg:motion-safe:supports-[animation-timeline:view()]:animate-[m-zoom-in_linear_both] " +
  "max-lg:motion-safe:supports-[animation-timeline:view()]:[animation-timeline:--home-hoods] " +
  "max-lg:motion-safe:supports-[animation-timeline:view()]:[animation-range:entry_0%_cover_45%]";

/**
 * "Elegí tu barrio": una fila de arcos (puertas/ventanas), uno por barrio con
 * unidades, con la portada de un depto real de ese barrio. Celular y tablet:
 * riel con barra de progreso (y en la home va antes del proceso: `className`).
 */
export function HomeHoods({ tiles, className }: { tiles: HoodTile[]; className?: string }) {
  if (tiles.length < 2) return null;

  return (
    <section className={cn("py-10 sm:py-14 lg:py-24", className)}>
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Barrios"
            title="Elegí tu barrio"
            accent="Córdoba, por unos días. Que se sienta un poco tuya."
          />
        </Reveal>
      </div>

      <SnapRail
        as="ul"
        label="Barrios con alojamientos"
        className={cn(
          // < lg: el ul ya ocupa todo el ancho de la sección, así que va sin los
          // márgenes negativos del riel (con el mismo padding de página).
          "max-sm:mx-0 sm:max-lg:mx-0",
          // ≥ lg: lo mismo que antes (fila centrada, gap-5, px-8, pb-3, mt-12).
          "mx-auto mt-7 max-w-[1320px] sm:mt-10 lg:mt-12 lg:flex lg:justify-center lg:gap-5 lg:px-8 lg:pb-3",
          RAIL_TIMELINE,
        )}
      >
        {tiles.map((t, i) => (
          <li key={t.slug} className="w-[8.25rem] shrink-0 snap-start sm:w-[9.5rem] lg:w-auto lg:max-w-[10.5rem] lg:flex-1">
            <Reveal delay={Math.min(i, 8) * 60} y={18}>
              <Link
                href={t.href}
                className="group block rounded-t-full rounded-b-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 focus-visible:ring-offset-4 focus-visible:ring-offset-cream"
              >
                <span className="relative block aspect-[3/4] overflow-hidden rounded-t-full rounded-b-2xl bg-leaf-200 shadow-apart-sm ring-1 ring-forest-900/5 transition-shadow duration-300 group-hover:shadow-apart-md">
                  {t.cover ? (
                    // El span sólo lleva el zoom de celular (en escritorio es una capa a
                    // tamaño completo sin estilo): el hover de la foto sigue en la imagen.
                    <span className={cn("absolute inset-0", PHOTO_ZOOM)}>
                      <Image
                        src={t.cover}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 168px, (min-width: 640px) 152px, 132px"
                        className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] motion-reduce:transition-none"
                      />
                    </span>
                  ) : (
                    <span className="flex size-full items-center justify-center text-forest-700/70">
                      <ApartLogo variant="symbol" title={null} className="h-10" />
                    </span>
                  )}
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-forest-950/25 to-transparent" />
                </span>
                <span className="mt-3 block text-[0.9375rem] font-extrabold leading-tight tracking-[-0.01em] text-forest-700 group-hover:underline group-hover:decoration-coral-500 group-hover:decoration-2 group-hover:underline-offset-4">
                  {t.name}
                </span>
                <span className="mt-0.5 block text-[0.8125rem] font-medium text-ink-500">{deptosLabel(t.count)}</span>
              </Link>
            </Reveal>
          </li>
        ))}
      </SnapRail>
    </section>
  );
}
