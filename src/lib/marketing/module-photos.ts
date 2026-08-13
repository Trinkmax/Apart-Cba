/**
 * Fotos de la sección de módulos de la landing.
 *
 * Cada módulo se ilustra con la ESCENA que representa —el cobro en el mostrador,
 * las chicas de limpieza preparando el departamento, la liquidación que se
 * revisa con el dueño—, no con una foto de un departamento cualquiera: la foto
 * tiene que decir de qué habla la tarjeta antes de que se lea el texto.
 *
 * Viven en Supabase Storage (bucket público `marketing`, carpeta `modulos`) y no
 * en `/public` a propósito: el loader de imágenes del proyecto
 * (`supabase-image-loader`) sólo transforma lo que sale de Supabase —ahí una
 * foto de 90 KB baja a ~26 KB en WebP por el CDN—; un JPEG en `/public` se
 * serviría entero y sin tocar.
 *
 * Origen: Pexels y Unsplash, todas con licencia libre para uso comercial (nada
 * de Unsplash+, que es de pago). El id de cada foto queda anotado para poder
 * volver a la original.
 */

const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/marketing/modulos`;

export type ModulePhoto = { url: string; alt: string };

export const MODULE_PHOTOS = {
  // pexels 6170652
  calendario: {
    url: `${BASE}/calendario.jpg`,
    alt: "Anotando las fechas de las reservas en un calendario",
  },
  // unsplash X7n9AVM71Z8 (licencia libre)
  canales: {
    url: `${BASE}/canales.jpg`,
    alt: "Un teléfono con la aplicación de Booking.com abierta",
  },
  // pexels 3907161
  caja: {
    url: `${BASE}/caja.jpg`,
    alt: "Cobro con tarjeta en el mostrador",
  },
  // pexels 7821671
  liquidaciones: {
    url: `${BASE}/liquidaciones.jpg`,
    alt: "Repasando el detalle de cuentas con el propietario",
  },
  // pexels 9462319
  servicio: {
    url: `${BASE}/limpieza.jpg`,
    alt: "El equipo de limpieza preparando el departamento entre estadías",
  },
  // pexels 5378703
  parte: {
    url: `${BASE}/parte-diario.jpg`,
    alt: "Huéspedes haciendo el check-in en recepción",
  },
} as const satisfies Record<string, ModulePhoto>;
