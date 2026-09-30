import Link from "next/link";
import { ArrowRight, CircleCheck, KeyRound, MessageCircleHeart } from "lucide-react";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { HeroSearchCard } from "@/components/marketplace/search/hero-search-card";
import { cn } from "@/lib/utils";
import { HeroArt } from "./hero-art";

const RISE =
  "motion-safe:animate-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";
const FADE_RISE = `${RISE} motion-safe:fade-in motion-safe:fill-mode-[both]`;

/**
 * Hero de la home (crema). Un solo grid para todos los tamaños:
 *
 *   celular / tablet (< lg)              desktop (lg)
 *   ┌───────────────────────┐            ┌──────────────┬──────────┐
 *   │ foto a sangre         │ 1 (flex)   │ (aire)       │          │
 *   │ eyebrow  ┐            │ 2          │ eyebrow      │          │
 *   │ titular  ├ encima     │ 3          │ titular      │   arco   │
 *   │ bajada   ┘ de la foto │ 4          │ bajada       │  + foto  │
 *   ├─╭─ buscador ──────╮───┤ 5 (borde)  │ buscador     │          │
 *   │ │                 │   │ 6          │ garantías    │          │
 *   │ ╰─────────────────╯   │            │ (aire)       │          │
 *   │  (N departamentos →)  │ 7          └──────────────┴──────────┘
 *   └───────────────────────┘
 * En celular la foto (la misma, una sola: es el LCP) ocupa las filas 1-5 y el
 * buscador arranca en la 5, así se encima al borde de la foto. Las garantías
 * se esconden < lg: ya las dicen el pie del buscador y "Cómo se reserva".
 * El buscador queda a la vista sin scrollear en un teléfono.
 */
export function HomeHero({
  responseHours,
  senaLabel,
  statsLabel,
}: {
  responseHours: number;
  /** "1 noche", "30 %"; null = la organización no pide seña. */
  senaLabel: string | null;
  /** "45 departamentos en 9 barrios"; null si el catálogo no cargó. */
  statsLabel: string | null;
}) {
  const guarantees = [
    { icon: CircleCheck, text: "Pedís sin pagar nada" },
    { icon: MessageCircleHeart, text: `Te confirmamos en menos de ${responseHours} h` },
    {
      icon: KeyRound,
      text: senaLabel ? `Seña de ${senaLabel}, el resto al llegar` : "Sin seña: pagás al llegar",
    },
  ];

  return (
    <section aria-labelledby="home-hero-title" className="relative overflow-hidden bg-cream">
      <div
        className={cn(
          "mx-auto grid max-w-[1320px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 pb-10 pt-6",
          "sm:gap-x-8 sm:px-6 sm:pb-14 sm:pt-10",
          "lg:min-h-[min(760px,calc(100svh-72px))] lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:grid-rows-[1fr_repeat(5,auto)_1fr] lg:gap-x-12 lg:px-8 lg:pb-16 lg:pt-8",
          "xl:gap-x-20",
          // < lg: una columna; fila 1 flexible (sólo foto), 2-4 textos sobre la foto,
          // 5 = franja de foto que tapa el buscador, 6 = resto del buscador, 7 = dato.
          "max-lg:grid-cols-1 max-lg:grid-rows-[minmax(1rem,1fr)_auto_auto_auto_4.5rem_auto_auto]",
          "max-lg:pb-5 max-lg:pt-0 sm:max-lg:pb-10 sm:max-lg:pt-0",
        )}
      >
        <Eyebrow
          className={cn(
            "col-span-2 mb-3 sm:mb-4 lg:col-span-1 lg:col-start-1 lg:row-start-2",
            // < lg: etiqueta translúcida sobre la foto (se lee sobre cualquier parte de la imagen).
            "max-lg:relative max-lg:z-10 max-lg:col-span-1 max-lg:col-start-1 max-lg:row-start-2 max-lg:w-fit max-lg:rounded-full max-lg:bg-forest-950/55 max-lg:px-3 max-lg:py-1.5 max-lg:text-cream max-lg:ring-1 max-lg:ring-inset max-lg:ring-white/10 max-lg:backdrop-blur-md",
            RISE,
          )}
        >
          Alquileres temporarios · Córdoba
        </Eyebrow>

        <h1
          id="home-hero-title"
          className={cn(
            "col-start-1 row-start-2 self-center font-apart leading-[1.04] tracking-[-0.03em] text-forest-700",
            "text-[clamp(1.75rem,7.6vw,2.5rem)] sm:text-[clamp(2.5rem,6.4vw,3.5rem)] lg:row-start-3 lg:text-[clamp(3.1rem,4.3vw,4.35rem)]",
            "max-lg:relative max-lg:z-10 max-lg:row-start-3 max-lg:text-cream max-lg:[text-shadow:0_2px_22px_rgb(6_32_27/0.4)]",
            RISE,
          )}
        >
          <span className="block font-extrabold">Tu lugar en Córdoba,</span>
          <span className="block font-medium">
            por el tiempo que necesites
            <BrandDot />
          </span>
        </h1>

        <HeroArt
          statsLabel={statsLabel}
          className={cn(
            "col-start-2 row-start-2 aspect-[3/4] w-[clamp(6.75rem,31vw,15rem)] self-center",
            "lg:row-span-7 lg:row-start-1 lg:aspect-[6/7] lg:w-full lg:max-w-[33rem] lg:justify-self-end",
            // < lg: bloque a sangre (anula el padding de página) de las filas 1 a 5; crece
            // si los textos no entran (landscape), nunca los deja fuera de la foto.
            "max-lg:col-start-1 max-lg:row-start-1 max-lg:row-end-6 max-lg:-mx-4 max-lg:aspect-auto max-lg:min-h-[min(62svh,34rem)] max-lg:w-auto max-lg:self-stretch sm:max-lg:-mx-6",
          )}
        />

        <p
          className={cn(
            "col-span-2 mt-4 font-apart-serif text-[1.1875rem] italic leading-snug text-forest-600 sm:mt-5 sm:text-2xl",
            "lg:col-span-1 lg:col-start-1 lg:row-start-4 lg:text-[1.625rem]",
            // < lg: encima de la foto; el mb deja aire de foto antes del buscador.
            "max-lg:relative max-lg:z-10 max-lg:col-span-1 max-lg:col-start-1 max-lg:row-start-4 max-lg:mb-6 max-lg:mt-2 max-lg:text-cream/90 sm:max-lg:mt-3",
            FADE_RISE,
            "motion-safe:delay-75",
          )}
        >
          Llegar debe sentirse simple.
        </p>

        <div
          className={cn(
            "col-span-2 mt-6 sm:mt-8 lg:col-span-1 lg:col-start-1 lg:row-start-5 lg:mt-9 lg:max-w-[40rem]",
            // < lg: arranca en la fila 5 (el borde de la foto) y se encima a la foto.
            "max-lg:relative max-lg:z-10 max-lg:col-span-1 max-lg:col-start-1 max-lg:row-start-5 max-lg:row-end-7 max-lg:mt-0 sm:max-lg:mt-0",
            FADE_RISE,
            "motion-safe:delay-150",
          )}
        >
          <HeroSearchCard responseHours={responseHours} />
        </div>

        <div
          className={cn(
            "col-span-2 mt-5 lg:col-span-1 lg:col-start-1 lg:row-start-6 lg:mt-7",
            "max-lg:col-span-1 max-lg:col-start-1 max-lg:row-start-7 max-lg:mt-4 max-lg:flex max-lg:justify-center",
            FADE_RISE,
            "motion-safe:delay-200",
          )}
        >
          {/* < lg no van: lo dicen el pie del buscador y "Cómo se reserva". */}
          <ul className="flex flex-col gap-2.5 max-lg:hidden sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            {guarantees.map((g) => (
              <li key={g.text} className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-ink-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-leaf-200 text-forest-700">
                  <g.icon className="size-[0.95rem]" aria-hidden />
                </span>
                {g.text}
              </li>
            ))}
          </ul>
          {/* Sólo < lg (en escritorio el dato va sobre la foto): pastilla chica bajo el buscador. */}
          {statsLabel ? (
            <Link
              href="/buscar"
              className={cn(
                "group inline-flex min-h-11 items-center gap-2.5 rounded-full bg-paper py-1.5 pl-1.5 pr-4 text-sm font-bold text-forest-700 shadow-apart-sm ring-1 ring-cream-300 lg:hidden",
                "outline-none transition-colors hover:bg-white focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
              )}
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-coral-500">
                <ApartLogo variant="symbol" title={null} className="h-4" />
              </span>
              <span>
                {statsLabel}
                <span className="sr-only">: elegí el tuyo</span>
              </span>
              <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
