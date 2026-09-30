import { cn } from "@/lib/utils";

/**
 * Fotos de marca de `/public/apart/photos` (narrativa, no unidades).
 *
 * Van con `<img srcSet>` nativo y NO con next/image: las fotos locales pasan
 * por el loader custom sin optimizar (devuelve la misma URL para todos los
 * anchos), así que el srcset de next/image repetiría un único archivo. Acá el
 * navegador elige entre los tamaños que ya están generados.
 */
const PHOTOS = {
  "balcon-cordoba": [
    { file: "balcon-cordoba-900.webp", w: 900, h: 507 },
    { file: "balcon-cordoba-1600.webp", w: 1600, h: 900 },
  ],
  "cuidado-cama": [
    { file: "cuidado-cama-700.webp", w: 700, h: 700 },
    { file: "cuidado-cama-1200.webp", w: 1200, h: 1200 },
  ],
  llaves: [
    { file: "llaves-800.webp", w: 800, h: 533 },
    { file: "llaves-1400.webp", w: 1383, h: 922 },
  ],
  "amenities-bano": [
    { file: "amenities-bano-700.webp", w: 700, h: 466 },
    { file: "amenities-bano-1076.webp", w: 1076, h: 717 },
  ],
  bienvenida: [{ file: "bienvenida-825.webp", w: 825, h: 687 }],
  "hacemos-lugar": [
    { file: "hacemos-lugar-900.webp", w: 900, h: 600 },
    { file: "hacemos-lugar-1536.webp", w: 1536, h: 1024 },
  ],
} as const;

export type BrandPhotoName = keyof typeof PHOTOS;

export function BrandPhoto({
  name,
  alt,
  sizes,
  priority = false,
  className,
}: {
  name: BrandPhotoName;
  /** Texto alternativo; "" si la foto es decorativa. */
  alt: string;
  /** Igual que en next/image: el ancho que ocupa en pantalla. */
  sizes: string;
  /** Hero / LCP: carga inmediata y prioridad alta. */
  priority?: boolean;
  className?: string;
}) {
  const variants = PHOTOS[name];
  const largest = variants[variants.length - 1];
  const smallest = variants[0];
  const srcSet = variants.map((v) => `/apart/photos/${v.file} ${v.w}w`).join(", ");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver comentario del módulo
    <img
      src={`/apart/photos/${smallest.file}`}
      srcSet={srcSet}
      sizes={sizes}
      width={largest.w}
      height={largest.h}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? undefined : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={cn("block size-full object-cover", className)}
    />
  );
}
