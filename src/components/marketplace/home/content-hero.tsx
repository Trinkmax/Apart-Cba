import { ArcBand, BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { cn } from "@/lib/utils";
import { BrandPhoto, type BrandPhotoName } from "./brand-photo";

const EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";
const RISE = `motion-safe:animate-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 ${EASE}`;

/**
 * Hero de las páginas de contenido ("Cómo reservar", "Propietarios"): titular
 * en dos pesos con el punto coral, bajada serif y, a la derecha, una foto de
 * marca recortada en arco con el arco forest detrás.
 *
 * En celular y tablet (< lg) la MISMA foto (no se duplica: es la prioritaria)
 * pasa arriba, a sangre y pegada al header, con un degradé forest; el eyebrow,
 * el titular y la frase serif van encima en crema, y la bajada y los botones
 * siguen debajo. Al bajar, la foto se aleja y se apaga (`.m-hero-fade`).
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
      <div
        className={cn(
          "mx-auto grid max-w-[1320px] items-center gap-12 px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:px-8 lg:pb-20 lg:pt-14 xl:gap-24",
          // Celular/tablet: la foto va primero, a sangre, y el titular se apoya encima.
          "max-lg:gap-0 max-lg:pb-10 max-lg:pt-0 sm:max-lg:pb-12 sm:max-lg:pt-0",
        )}
      >
        {/* En celular este bloque se "disuelve" (contents): el titular comparte la
            celda de la foto y la bajada con los botones siguen debajo. */}
        <div className="max-lg:contents">
          <div className="max-lg:relative max-lg:z-10 max-lg:col-start-1 max-lg:row-start-1 max-lg:self-end max-lg:pb-8 max-lg:pt-24 max-lg:[text-shadow:0_1px_18px_rgb(6_32_27/0.35)]">
            <Eyebrow className={cn("mb-4", RISE, "max-lg:text-leaf-200")}>{eyebrow}</Eyebrow>
            <h1
              id={titleId}
              className={cn(
                "font-apart leading-[1.04] tracking-[-0.03em] text-forest-700 text-balance",
                "text-[clamp(2.125rem,8.4vw,3rem)] sm:text-[clamp(2.75rem,6vw,3.5rem)] lg:text-[clamp(3rem,4.2vw,4.125rem)]",
                RISE,
                "max-lg:text-cream",
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
                "max-lg:text-cream/90",
              )}
            >
              {accent}
            </p>
          </div>
          {lead ? (
            <div
              className={cn(
                "mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-ink-700 sm:text-lg",
                RISE,
                "motion-safe:delay-150 motion-safe:fill-mode-[both] motion-safe:fade-in",
                "max-lg:mt-7 sm:max-lg:mt-8",
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

        <figure
          className={cn(
            "relative isolate mx-auto aspect-[5/6] w-[min(66vw,16.5rem)] sm:w-[21rem] lg:mr-0 lg:w-full lg:max-w-[31rem]",
            // Celular/tablet: a sangre (borde a borde, pegada al header), misma celda que el titular.
            "max-lg:col-start-1 max-lg:row-start-1 max-lg:-mx-4 max-lg:aspect-auto max-lg:min-h-[min(56svh,30rem)] max-lg:w-auto max-lg:self-stretch sm:max-lg:-mx-6 sm:max-lg:w-auto",
          )}
        >
          {/* Arco forest detrás, corrido arriba a la derecha. */}
          <div
            aria-hidden
            className={cn(
              "absolute right-0 top-0 h-[90%] w-[84%] rounded-t-full bg-forest-700",
              "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-1000",
              EASE,
              "max-lg:hidden",
            )}
          />
          <div className="absolute bottom-0 left-0 h-[90%] w-[84%] overflow-hidden rounded-t-full rounded-b-[1.75rem] bg-cream-300 shadow-apart-lg ring-1 ring-forest-900/5 max-lg:inset-0 max-lg:h-full max-lg:w-full max-lg:rounded-t-none max-lg:rounded-b-[2rem] max-lg:bg-forest-700 max-lg:shadow-none max-lg:ring-0">
            {/* La foto se aleja y se apaga (hacia el forest) al empezar a bajar: sólo en celular. */}
            <div className="m-hero-fade size-full">
              <BrandPhoto
                name={photo.name}
                alt={photo.alt}
                priority
                // En celular la foto va a sangre (100vw); en escritorio, igual que antes.
                sizes="(min-width: 1024px) 420px, 100vw"
                className={cn(
                  photo.position ?? "object-center",
                  "motion-safe:animate-in motion-safe:zoom-in-105 motion-safe:duration-[1400ms]",
                  EASE,
                )}
              />
            </div>
            {/* Degradé forest para leer el titular crema (sólo celular). Paradas en rem, no en %:
                cubren el alto del bloque de texto sea cual sea el alto de la foto. */}
            <div
              aria-hidden
              className="absolute inset-0 bg-linear-to-t from-forest-900/95 via-forest-900/75 via-[length:11.5rem] to-forest-900/0 to-[length:19rem] sm:via-[length:15rem] sm:to-[length:25rem] lg:hidden"
            />
          </div>
          <span
            aria-hidden
            className={cn(
              "absolute left-[-4%] top-[12%] size-[12%] rounded-full bg-coral-500 shadow-apart-sm",
              "motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:delay-500 motion-safe:duration-700 motion-safe:fill-mode-[both]",
              EASE,
              "max-lg:hidden",
            )}
          />
          <ArcBand
            thickness={10}
            className="absolute -bottom-3 -right-6 -z-10 w-[46%] text-leaf-300 sm:-right-10 max-lg:hidden"
          />
          {caption ? (
            // En celular se esconde: la foto va a sangre con el titular encima y
            // el chip quedaba sobre el degradé (en "Cómo reservar" la frase se repite más abajo).
            <figcaption className="absolute -bottom-4 left-[6%] max-w-[80%] rounded-full bg-paper px-4 py-2.5 font-apart-serif text-[0.9375rem] italic leading-tight text-forest-700 shadow-apart-md ring-1 ring-cream-300 sm:text-base max-lg:hidden">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}
