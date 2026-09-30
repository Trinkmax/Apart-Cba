import Image from "next/image";
import Link from "next/link";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";
import { deptosLabel, type HoodTile } from "./home-data";

/**
 * "Elegí tu barrio": una fila de arcos (puertas/ventanas), uno por barrio con
 * unidades, con la portada de un depto real de ese barrio. Mobile: carrusel.
 */
export function HomeHoods({ tiles }: { tiles: HoodTile[] }) {
  if (tiles.length < 2) return null;

  return (
    <section className="py-14 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Barrios"
            title="Elegí tu barrio"
            accent="Córdoba, por unos días. Que se sienta un poco tuya."
          />
        </Reveal>
      </div>

      <ul
        aria-label="Barrios con alojamientos"
        className={
          "mx-auto mt-9 flex max-w-[1320px] snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 sm:mt-12 sm:scroll-px-6 sm:px-6 " +
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
          "lg:snap-none lg:justify-center lg:gap-5 lg:overflow-visible lg:px-8"
        }
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
                    <Image
                      src={t.cover}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 168px, (min-width: 640px) 152px, 132px"
                      className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06] motion-reduce:transition-none"
                    />
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
      </ul>
    </section>
  );
}
