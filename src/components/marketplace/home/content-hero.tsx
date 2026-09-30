import { ArcBand, BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import { BrandPhoto, type BrandPhotoName } from "./brand-photo";

const EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";
const RISE = `motion-safe:animate-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 ${EASE}`;

/**
 * Hero de las páginas de contenido ("Cómo reservar", "Propietarios"): titular
 * en dos pesos con el punto coral, bajada serif y, a la derecha, una foto de
 * marca recortada en arco con el arco forest detrás. En mobile la foto va
 * debajo del texto, más chica, para que el contenido arranque enseguida.
 *
 * El texto nunca arranca invisible (sólo sube unos px): es el LCP de la página.
 */
export function ContentHero({
  id,
  eyebrow,
  strong,
  soft,
  accent,
  lead,
  photo,
  caption,
  children,
}: {
  /** Prefijo de ids (aria-labelledby). */
  id: string;
  eyebrow: string;
  /** Primera línea del titular (extrabold). */
  strong: string;
  /** Segunda línea (medium); el punto coral cierra la última línea. */
  soft?: string;
  /** Bajada en serif itálica (frase de marca). */
  accent: string;
  lead?: React.ReactNode;
  photo: { name: BrandPhotoName; alt: string; position?: string };
  /** Frase corta en serif sobre la foto (chip). */
  caption?: string;
  /** Botones. */
  children?: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} className="relative overflow-hidden bg-cream">
      <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:px-8 lg:pb-20 lg:pt-14 xl:gap-24">
        <div>
          <Eyebrow className={cn("mb-4", RISE)}>{eyebrow}</Eyebrow>
          <h1
            id={titleId}
            className={cn(
              "font-apart leading-[1.04] tracking-[-0.03em] text-forest-700 text-balance",
              "text-[clamp(2.125rem,8.4vw,3rem)] sm:text-[clamp(2.75rem,6vw,3.5rem)] lg:text-[clamp(3rem,4.2vw,4.125rem)]",
              RISE,
            )}
          >
            <span className="block font-extrabold">
              {strong}
              {soft ? null : <BrandDot />}
            </span>
            {soft ? (
              <span className="block font-medium">
                {soft}
                <BrandDot />
              </span>
            ) : null}
          </h1>
          <p
            className={cn(
              "mt-4 font-apart-serif text-xl italic leading-snug text-forest-600 sm:mt-5 sm:text-2xl",
              RISE,
              "motion-safe:delay-100 motion-safe:fill-mode-[both] motion-safe:fade-in",
            )}
          >
            {accent}
          </p>
          {lead ? (
            <div
              className={cn(
                "mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-700 sm:text-lg",
                RISE,
                "motion-safe:delay-150 motion-safe:fill-mode-[both] motion-safe:fade-in",
              )}
            >
              {lead}
            </div>
          ) : null}
          {children ? (
            <div
              className={cn(
                "mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap",
                RISE,
                "motion-safe:delay-200 motion-safe:fill-mode-[both] motion-safe:fade-in",
              )}
            >
              {children}
            </div>
          ) : null}
        </div>

        <figure className="relative isolate mx-auto aspect-[5/6] w-[min(66vw,16.5rem)] sm:w-[21rem] lg:mr-0 lg:w-full lg:max-w-[31rem]">
          {/* Arco forest detrás, corrido arriba a la derecha. */}
          <div
            aria-hidden
            className={cn(
              "absolute right-0 top-0 h-[90%] w-[84%] rounded-t-full bg-forest-700",
              "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-1000",
              EASE,
            )}
          />
          <div className="absolute bottom-0 left-0 h-[90%] w-[84%] overflow-hidden rounded-t-full rounded-b-[1.75rem] bg-cream-300 shadow-apart-lg ring-1 ring-forest-900/5">
            <BrandPhoto
              name={photo.name}
              alt={photo.alt}
              priority
              sizes="(min-width: 1024px) 420px, (min-width: 640px) 18rem, 56vw"
              className={cn(
                photo.position ?? "object-center",
                "motion-safe:animate-in motion-safe:zoom-in-105 motion-safe:duration-[1400ms]",
                EASE,
              )}
            />
          </div>
          <span
            aria-hidden
            className={cn(
              "absolute left-[-4%] top-[12%] size-[12%] rounded-full bg-coral-500 shadow-apart-sm",
              "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:delay-500 motion-safe:duration-700 motion-safe:fill-mode-[both]",
              EASE,
            )}
          />
          <ArcBand
            thickness={10}
            className="absolute -bottom-3 -right-6 -z-10 w-[46%] text-leaf-300 sm:-right-10"
          />
          {caption ? (
            <figcaption className="absolute -bottom-4 left-[6%] max-w-[80%] rounded-full bg-paper px-4 py-2.5 font-apart-serif text-[0.9375rem] italic leading-tight text-forest-700 shadow-apart-md ring-1 ring-cream-300 sm:text-base">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}
