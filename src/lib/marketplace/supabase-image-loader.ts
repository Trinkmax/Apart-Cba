// Custom Next.js image loader (configurado en `next.config.ts` → images.loaderFile).
//
// POR QUÉ EXISTE: el optimizador de imágenes de Vercel (`/_next/image`) devuelve
// HTTP 402 `OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` cuando se agota la cuota del
// plan. Eso dejaba TODAS las <Image> optimizadas (galería de fotos, marketplace,
// tips) en blanco/gris. La URL pública de Supabase responde 200, pero el `<img>`
// pedía la versión `/_next/image?...` y esa era la que fallaba.
//
// QUÉ HACE: reescribe las URLs públicas de Supabase Storage al endpoint de
// transformación on-the-fly de Supabase (`render/image`), que sirve WebP
// redimensionado desde su CDN — sin pasar nunca por Vercel. Para una foto de
// ~530 KB devuelve ~19 KB @640px y ~115 KB @1920px.
//
// Cualquier otra URL (Mapbox, assets locales, URLs firmadas/privadas, data:) se
// devuelve tal cual: pasa derecho al navegador sin optimizar. Las <Image> con
// `unoptimized` ni siquiera invocan este loader.

const PUBLIC_OBJECT_MARKER = "/storage/v1/object/public/";

// Supabase transforma como mucho ~2500px de lado; acotamos para no pedir
// transformaciones gigantes que ninguna card/galería necesita.
const MAX_TRANSFORM_WIDTH = 2560;

type ImageLoaderProps = {
  src: string;
  width: number;
  quality?: number;
};

export default function supabaseImageLoader({
  src,
  width,
  quality,
}: ImageLoaderProps): string {
  const markerIdx = src.indexOf(PUBLIC_OBJECT_MARKER);

  // No es un objeto público de Supabase → passthrough (Mapbox, /public, firmadas…).
  if (markerIdx === -1 || !src.includes(".supabase.")) {
    return src;
  }

  const base = src.slice(0, markerIdx); // https://<ref>.supabase.co
  const objectPath = src.slice(markerIdx + PUBLIC_OBJECT_MARKER.length); // <bucket>/<path>

  const w = Math.min(Math.max(Math.round(width) || 0, 16), MAX_TRANSFORM_WIDTH);
  const q = Math.min(Math.max(Math.round(quality ?? 75) || 75, 20), 100);

  return `${base}/storage/v1/render/image/public/${objectPath}?width=${w}&quality=${q}&resize=contain`;
}
