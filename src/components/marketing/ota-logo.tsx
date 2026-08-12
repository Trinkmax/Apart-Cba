import Image from "next/image";

/**
 * Marcas de los canales de venta. Los SVG viven en `public/brand/ota/` y salen
 * de Simple Icons (los íconos son CC0; las marcas siguen siendo de sus dueños,
 * acá se usan sólo para identificar con qué se integra rentOS).
 *
 * Van con `unoptimized` porque el loader de imágenes del proyecto es custom
 * (`supabase-image-loader`) y deja pasar sin optimizar todo lo que no sea
 * Supabase Storage: pedirle un resize a un SVG local no hace nada.
 */

const OTA = {
  airbnb: { src: "/brand/ota/airbnb.svg", alt: "Airbnb" },
  booking: { src: "/brand/ota/booking.svg", alt: "Booking.com" },
} as const;

export type OtaBrand = keyof typeof OTA;

export function OtaLogo({ brand, size = 20 }: { brand: OtaBrand; size?: number }) {
  const { src, alt } = OTA[brand];
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      className="shrink-0 object-contain"
    />
  );
}
