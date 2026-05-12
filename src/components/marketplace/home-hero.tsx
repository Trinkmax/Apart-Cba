import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { HeroSearchBar } from "@/components/marketplace/search-bar";
import { Reveal } from "@/components/marketplace/reveal";
import { WordReveal } from "@/components/marketplace/word-reveal";

/**
 * Returns "otoño", "invierno", "primavera" o "verano" para Córdoba (hemisferio sur).
 * Server-rendered, dependiente del Date() del servidor — Vercel está en UTC,
 * pero la magnitud del mes mantiene la categoría correcta.
 */
function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return "Otoño";
  if (month >= 6 && month <= 8) return "Invierno";
  if (month >= 9 && month <= 11) return "Primavera";
  return "Verano";
}

export function HomeHero() {
  const now = new Date();
  const season = getSeason(now.getMonth() + 1);
  const year = now.getFullYear();

  return (
    <section
      className="relative isolate overflow-hidden flex items-center
                 -mt-[148px] pt-[180px] pb-20 md:pb-28
                 min-h-[760px] md:min-h-[820px]"
    >
      {/* Background image with Ken Burns. Lives in its own absolute layer so
          the cinematic motion doesn't drag the content with it. */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          src="/cordoba/ciudad.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover animate-ken-burns"
        />
      </div>

      {/* Cinematic gradient stack — top fades to dark for header legibility,
          a vignette focuses the center, and the bottom darkens for the search bar. */}
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-black/55 via-black/20 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,transparent_0%,rgba(0,0,0,0.35)_60%,rgba(0,0,0,0.55)_100%)] pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black/65 via-black/15 to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mx-auto text-center text-white">
          {/* Eyebrow — animated live dot + editorial caption */}
          <Reveal delay={50} y={10}>
            <div className="inline-flex items-center gap-2.5 rounded-full
                            border border-white/20 bg-white/[0.06] backdrop-blur-md
                            px-3.5 py-1.5 text-[10.5px] font-semibold uppercase
                            tracking-[0.22em] text-white/85">
              <span className="relative inline-flex h-2 w-2 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 animate-ping" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
              </span>
              <span>Córdoba · Argentina</span>
              <span className="text-white/40">·</span>
              <span>{season} {year}</span>
            </div>
          </Reveal>

          {/* Headline — letter/word-level reveal via CSS keyframes */}
          <h1 className="mt-7 font-bold tracking-[-0.025em] leading-[1.02]
                         text-[2.6rem] sm:text-5xl md:text-[5.25rem]
                         [text-shadow:0_2px_30px_rgb(0_0_0/0.4)]">
            <WordReveal text="Quedate donde" />
            <br />
            <span className="italic font-serif font-medium">
              <WordReveal text="la ciudad late." startIndex={2} />
            </span>
          </h1>

          <Reveal delay={900} y={12}>
            <p className="mt-6 text-base md:text-lg text-white/85 max-w-xl mx-auto leading-relaxed">
              Departamentos curados en barrios reales. Reservás directo con el
              anfitrión, sin comisiones escondidas.
            </p>
          </Reveal>
        </div>

        <Reveal delay={1100} y={16} className="block mt-10 md:mt-12 max-w-5xl mx-auto">
          <HeroSearchBar />
        </Reveal>

        <Reveal
          delay={1400}
          y={10}
          className="mt-10 md:mt-14 flex flex-col items-center gap-2 text-white/70"
        >
          <span className="text-[10px] tracking-[0.24em] uppercase font-semibold">
            Scrolleá para descubrir
          </span>
          <ChevronDown size={18} className="animate-scroll-cue" strokeWidth={1.75} />
        </Reveal>
      </div>
    </section>
  );
}
