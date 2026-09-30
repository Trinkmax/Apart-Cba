"use client";

import { useRef, useState } from "react";
import { preload } from "react-dom";
import dynamic from "next/dynamic";
import Image, { getImageProps } from "next/image";
import { Images, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnitPhoto } from "@/lib/types/database";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";

// El visor pesa poco, pero no hace falta hasta que alguien toca una foto.
const GalleryLightbox = dynamic(() => import("./listing/gallery-lightbox"), { ssr: false });

/** 75000 → "1:15". */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Posición de cada foto en el mosaico según cuántas hay (1 grande + hasta 4). */
function tileClass(i: number, n: number): string {
  if (n === 1) return "col-span-4 row-span-2";
  if (i === 0) return "col-span-2 row-span-2";
  if (n === 2) return "col-span-2 row-span-2";
  if (n === 3) return "col-span-2";
  if (n === 4 && i === 1) return "col-span-2";
  return "";
}

function altFor(p: UnitPhoto, title: string, i: number, n: number): string {
  if (p.alt_text) return p.alt_text;
  return i === 0 ? title : `${title}, ${p.media_type === "video" ? "video" : "foto"} ${i + 1} de ${n}`;
}

const PHOTO_CLASS =
  "object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-hover:scale-[1.03]";

/** Breakpoint `md` de Tailwind (48rem): debajo se ve el carrusel; desde ahí, el mosaico. */
const CAROUSEL_MEDIA = "(width < 48rem)";
const MOSAIC_MEDIA = "(width >= 48rem)";

/** GIF transparente de 1×1 (no hace pedido de red). */
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * La portada, que casi siempre es el LCP de la ficha. El carrusel y el mosaico
 * la dibujan cada uno a su tamaño y sólo uno de los dos se ve: con dos
 * <Image priority> el navegador precargaba y bajaba LAS DOS (la oculta
 * también, a hasta 2560 px). Acá cada copia va en un <picture> cuyo <source>
 * para el otro breakpoint es un GIF vacío, y el preload lleva `media`: cada
 * pantalla baja UNA portada, con prioridad alta y al ancho que usa.
 * (React no precarga solo un <img> dentro de <picture>: el preload es éste.)
 */
function CoverPicture({ photo, alt, sizes, media }: { photo: UnitPhoto; alt: string; sizes: string; media: string }) {
  const { props } = getImageProps({
    src: photo.public_url,
    alt,
    fill: true,
    sizes,
    loading: "eager",
    fetchPriority: "high",
    className: PHOTO_CLASS,
  });
  preload(props.src, {
    as: "image",
    imageSrcSet: props.srcSet,
    imageSizes: props.sizes,
    fetchPriority: "high",
    media,
  });
  return (
    <picture>
      <source media={media === CAROUSEL_MEDIA ? MOSAIC_MEDIA : CAROUSEL_MEDIA} srcSet={BLANK_GIF} />
      <img {...props} alt={alt} />
    </picture>
  );
}

/** Una foto (o el póster de un video) que llena su contenedor. La portada va por CoverPicture. */
function Media({
  photo,
  alt,
  sizes,
  cover,
  playSize = "size-12",
}: {
  photo: UnitPhoto;
  alt: string;
  sizes: string;
  /** Portada: `media` del breakpoint en el que se ve esta copia. */
  cover?: string;
  playSize?: string;
}) {
  if (cover && photo.media_type !== "video" && photo.public_url) {
    return <CoverPicture photo={photo} alt={alt} sizes={sizes} media={cover} />;
  }
  if (photo.media_type === "video") {
    return (
      <>
        {photo.poster_url ? (
          <Image src={photo.poster_url} alt={alt} fill sizes={sizes} className="object-cover" />
        ) : (
          <span className="absolute inset-0 bg-forest-800" />
        )}
        <span className="absolute inset-0 grid place-items-center">
          <PlayCircle className={cn("text-cream drop-shadow-lg", playSize)} strokeWidth={1.5} aria-hidden />
        </span>
        {photo.duration_ms ? (
          <span className="absolute right-2 bottom-2 rounded-full bg-forest-950/75 px-2 py-0.5 text-[0.6875rem] font-semibold text-cream tabular-nums">
            {formatDuration(photo.duration_ms)}
          </span>
        ) : null}
      </>
    );
  }
  return <Image src={photo.public_url} alt={alt} fill sizes={sizes} className={PHOTO_CLASS} />;
}

/**
 * Botones sobre la foto en celular (volver, compartir, guardar): arriba, a los
 * dos costados. Sólo existen por debajo de md, igual que el carrusel.
 */
function PhotoOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] flex items-start justify-between gap-2 p-3 md:hidden [&>*]:pointer-events-auto">
      {children}
    </div>
  );
}

/**
 * Galería de la ficha.
 * - Celular (< md): va primera, a sangre y alta; carrusel con swipe
 *   (scroll-snap), contador "1/12", parallax suave al bajar (.m-parallax) y
 *   los botones de `overlay` encima. La hoja del título se le encima abajo.
 * - Escritorio: mosaico de 1 grande + 4 con "Ver las N fotos".
 * Tocar cualquier foto abre el visor en esa foto.
 *
 * photos[0] es la portada (orden is_cover DESC, sort_order ASC; un video nunca
 * es portada por CHECK en la base). Igual se dibuja defensivamente.
 */
export function UnitGallery({
  photos,
  title,
  className,
  overlay,
}: {
  photos: UnitPhoto[];
  title: string;
  className?: string;
  /** Botones sobre la foto, sólo en celular (< md). */
  overlay?: React.ReactNode;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const n = photos.length;

  if (n === 0) {
    return (
      <div
        className={cn(
          "relative grid aspect-[16/9] place-items-center overflow-hidden rounded-3xl bg-leaf-100 text-forest-700 md:aspect-[21/8]",
          // Celular: a sangre y sin redondear, como el carrusel (la hoja del título tapa el borde de abajo).
          "max-md:rounded-none max-md:pb-6 max-sm:-mx-4 sm:max-md:-mx-6",
          className,
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <ApartLogo variant="symbol" className="h-12 text-forest-700/70" title={null} />
          <p className="text-sm font-semibold">Todavía no cargamos las fotos de este lugar.</p>
        </div>
        {overlay ? <PhotoOverlay>{overlay}</PhotoOverlay> : null}
      </div>
    );
  }

  const hasVideo = photos.some((p) => p.media_type === "video");
  const seeAllLabel = hasVideo ? `Ver fotos y videos (${n})` : n === 1 ? "Ver la foto" : `Ver las ${n} fotos`;

  function onTrackScroll() {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== slide) setSlide(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div className={className}>
      {/* Celular: carrusel a sangre, alto (cuadrado en un teléfono, con tope de
          62svh). La pista entera lleva el parallax: sus fotos no pueden, porque
          su contenedor de scroll más cercano sería la pista horizontal. El
          recorte es overflow-clip y NO overflow-hidden: hidden crea un
          contenedor de scroll y view() se engancharía a él (efecto congelado). */}
      <div className="relative -mx-4 overflow-clip sm:-mx-6 md:hidden">
        <div
          ref={trackRef}
          onScroll={onTrackScroll}
          className="m-parallax no-scrollbar flex h-[min(100vw,62svh)] snap-x snap-mandatory overflow-x-auto overscroll-x-contain sm:h-[min(75vw,62svh)]"
          aria-label={`Fotos de ${title}`}
          role="region"
          aria-roledescription="carrusel"
        >
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="relative h-full w-full shrink-0 snap-center bg-cream-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/50"
              aria-label={`Abrir ${p.media_type === "video" ? "video" : "foto"} ${i + 1} de ${n}`}
            >
              <Media photo={p} alt={altFor(p, title, i, n)} sizes="100vw" cover={i === 0 ? CAROUSEL_MEDIA : undefined} />
            </button>
          ))}
        </div>
        {/* bottom-9: por encima de los 24 px que tapa la hoja del título. */}
        {n > 1 ? (
          <span
            className="pointer-events-none absolute right-3 bottom-9 rounded-full bg-forest-950/70 px-2.5 py-1 text-xs font-semibold text-cream tabular-nums backdrop-blur-sm"
            aria-live="polite"
          >
            {slide + 1}/{n}
          </span>
        ) : null}
        {overlay ? <PhotoOverlay>{overlay}</PhotoOverlay> : null}
      </div>

      {/* Escritorio: mosaico */}
      <div className="relative hidden md:block">
        <div className="grid h-[420px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl lg:h-[480px]">
          {photos.slice(0, 5).map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className={cn(
                "group relative overflow-hidden bg-cream-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/60",
                tileClass(i, Math.min(n, 5)),
              )}
              aria-label={`Abrir ${p.media_type === "video" ? "video" : "foto"} ${i + 1} de ${n}`}
            >
              <Media
                photo={p}
                alt={altFor(p, title, i, n)}
                sizes={i === 0 || n <= 2 ? "(max-width: 1279px) 50vw, 640px" : "(max-width: 1279px) 25vw, 320px"}
                cover={i === 0 ? MOSAIC_MEDIA : undefined}
                playSize={i === 0 ? "size-16" : "size-10"}
              />
            </button>
          ))}
        </div>
        {n > 1 ? (
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            className="absolute right-4 bottom-4 inline-flex h-10 items-center gap-2 rounded-full bg-paper px-4 text-sm font-semibold text-forest-700 shadow-apart-md ring-1 ring-cream-300 transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
          >
            <Images className="size-4" aria-hidden />
            {seeAllLabel}
          </button>
        ) : null}
      </div>

      {lightboxIndex !== null ? (
        <GalleryLightbox photos={photos} startIndex={lightboxIndex} title={title} onClose={() => setLightboxIndex(null)} />
      ) : null}
    </div>
  );
}
