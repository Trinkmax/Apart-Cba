import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArcBand } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import { BrandPhoto } from "./brand-photo";

const EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * La composición del hero: un arco forest enorme detrás, la foto del living
 * con vista a la Catedral recortada en arco adelante, el punto coral y la
 * banda salvia. Es UN solo elemento que cambia de escala: en mobile es la
 * "ventana" chica al lado del titular; desde lg ocupa la columna derecha.
 * (Uno solo a propósito: dos fotos, una oculta por breakpoint, se bajan las dos.)
 *
 * La foto es el LCP: nunca arranca invisible (sólo se asienta de 105 % a
 * 100 % de escala, con la opacidad siempre en 1).
 *
 * Por debajo de lg la MISMA foto es un bloque a sangre con el borde de abajo en
 * arco y un degradé forest para leer el titular (que va encima, en el grid del
 * hero); el arco forest, el punto y la banda se esconden. Al bajar, la foto se
 * aleja y se apaga (`.m-hero-fade`, atado al scroll de la página).
 */
export function HeroArt({ statsLabel, className }: { statsLabel: string | null; className?: string }) {
  return (
    <div className={cn("relative isolate", className)}>
      {/* Arco forest, desplazado arriba a la derecha. */}
      <div
        aria-hidden
        className={cn(
          "absolute right-0 top-0 h-[88%] w-[82%] rounded-t-full bg-forest-700 max-lg:hidden",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:duration-1000",
          EASE,
        )}
      />
      {/* Hilo salvia que acompaña la curva del arco forest. */}
      <div
        aria-hidden
        className="absolute right-[5%] top-[4%] hidden h-[80%] w-[72%] rounded-t-full border-2 border-b-0 border-leaf-300/35 lg:block"
      />

      {/* Foto en arco (adelante). */}
      <div
        className={cn(
          "absolute bottom-0 left-0 h-[88%] w-[82%] overflow-hidden rounded-t-full rounded-b-2xl bg-cream-300 shadow-apart-lg ring-1 ring-forest-900/5 lg:rounded-b-[1.75rem]",
          "max-lg:h-full max-lg:w-full max-lg:rounded-t-none max-lg:rounded-b-[50%_2.5rem] max-lg:shadow-none max-lg:ring-0",
        )}
      >
        <BrandPhoto
          name="balcon-cordoba"
          priority
          alt="Living luminoso de un departamento, con el balcón abierto y la Catedral de Córdoba de fondo"
          // < lg la foto cubre un bloque más alto que ancho: se dibuja ~1,3 veces (tablet)
          // a ~2,4 veces (teléfono) el ancho de la pantalla. Desde lg, lo mismo de siempre.
          sizes="(min-width: 1280px) 460px, (min-width: 1024px) 36vw, (min-width: 640px) 130vw, 240vw"
          className={cn(
            "object-[60%_50%]",
            "motion-safe:animate-in motion-safe:zoom-in-105 motion-safe:duration-[1600ms]",
            EASE,
            // Sólo < lg (y con animaciones por scroll): reemplaza la entrada por el alejarse al bajar.
            "m-hero-fade",
          )}
        />
        {/* Degradé forest para leer el titular encima de la foto (sólo < lg). Las paradas
            van en rem desde abajo, no en %: el texto ocupa siempre lo mismo y en una foto
            baja (celular apaisado) tiene que seguir cubierto. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(6_32_27/0.95)_0,rgb(6_32_27/0.84)_9rem,rgb(6_32_27/0.5)_17rem,rgb(6_32_27/0)_26rem)] lg:hidden"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
      </div>

      {/* Punto coral: el punto final de la marca. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-[-3%] top-[13%] size-[11%] rounded-full bg-coral-500 shadow-apart-sm max-lg:hidden",
          "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:duration-700 motion-safe:delay-500 motion-safe:fill-mode-[both]",
          EASE,
        )}
      />

      {/* Banda de medio arco salvia, abajo a la derecha. */}
      <ArcBand
        thickness={18}
        className={cn(
          "absolute bottom-0 right-[-4%] w-[34%] text-leaf-300 max-lg:hidden",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 motion-safe:delay-300 motion-safe:fill-mode-[both]",
          EASE,
        )}
      />

      {/* Dato real del catálogo (desde lg; en mobile va debajo del buscador). */}
      {statsLabel ? (
        <Link
          href="/buscar"
          className={cn(
            "group absolute bottom-[11%] left-[-14%] hidden items-center gap-3.5 rounded-full bg-paper/95 py-2.5 pl-2.5 pr-5 shadow-apart-lg ring-1 ring-cream-300 backdrop-blur lg:flex",
            "outline-none transition-transform duration-300 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
            "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:delay-700 motion-safe:fill-mode-[both]",
            EASE,
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-leaf-100 text-coral-500">
            <ApartLogo variant="symbol" title={null} className="h-5" />
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[0.9375rem] font-extrabold text-forest-700">{statsLabel}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ink-500">
              Verlos todos
              <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
            </span>
          </span>
        </Link>
      ) : null}
    </div>
  );
}
