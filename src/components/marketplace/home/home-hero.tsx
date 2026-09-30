import Link from "next/link";
import { ArrowRight, CircleCheck, KeyRound, MessageCircleHeart } from "lucide-react";
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
 *   mobile / tablet                      desktop (lg)
 *   ┌───────────────────────┐            ┌──────────────┬──────────┐
 *   │ eyebrow               │            │ (aire)       │          │
 *   │ titular        │ arco │            │ eyebrow      │          │
 *   │ bajada serif          │            │ titular      │   arco   │
 *   │ buscador              │            │ bajada       │  + foto  │
 *   │ garantías             │            │ buscador     │          │
 *   └───────────────────────┘            │ garantías    │          │
 *                                        │ (aire)       │          │
 *                                        └──────────────┴──────────┘
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
        )}
      >
        <Eyebrow className={cn("col-span-2 mb-3 sm:mb-4 lg:col-span-1 lg:col-start-1 lg:row-start-2", RISE)}>
          Alquileres temporarios · Córdoba
        </Eyebrow>

        <h1
          id="home-hero-title"
          className={cn(
            "col-start-1 row-start-2 self-center font-apart leading-[1.04] tracking-[-0.03em] text-forest-700",
            "text-[clamp(1.75rem,7.6vw,2.5rem)] sm:text-[clamp(2.5rem,6.4vw,3.5rem)] lg:row-start-3 lg:text-[clamp(3.1rem,4.3vw,4.35rem)]",
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
          )}
        />

        <p
          className={cn(
            "col-span-2 mt-4 font-apart-serif text-[1.1875rem] italic leading-snug text-forest-600 sm:mt-5 sm:text-2xl",
            "lg:col-span-1 lg:col-start-1 lg:row-start-4 lg:text-[1.625rem]",
            FADE_RISE,
            "motion-safe:delay-75",
          )}
        >
          Llegar debe sentirse simple.
        </p>

        <div
          className={cn(
            "col-span-2 mt-6 sm:mt-8 lg:col-span-1 lg:col-start-1 lg:row-start-5 lg:mt-9 lg:max-w-[40rem]",
            FADE_RISE,
            "motion-safe:delay-150",
          )}
        >
          <HeroSearchCard responseHours={responseHours} />
        </div>

        <div
          className={cn(
            "col-span-2 mt-5 lg:col-span-1 lg:col-start-1 lg:row-start-6 lg:mt-7",
            FADE_RISE,
            "motion-safe:delay-200",
          )}
        >
          <ul className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            {guarantees.map((g) => (
              <li key={g.text} className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-ink-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-leaf-200 text-forest-700">
                  <g.icon className="size-[0.95rem]" aria-hidden />
                </span>
                {g.text}
              </li>
            ))}
          </ul>
          {statsLabel ? (
            <Link
              href="/buscar"
              className="group mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-forest-700 underline decoration-forest-700/25 underline-offset-4 hover:decoration-forest-700 lg:hidden"
            >
              {statsLabel}: elegí el tuyo
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
