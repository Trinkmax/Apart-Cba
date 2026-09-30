/**
 * Clases del riel horizontal de celular/tablet (por debajo de `lg`). Viven en
 * un módulo SIN "use client" a propósito: si un server component las importara
 * desde `snap-rail.tsx` (que es cliente) recibiría referencias de cliente en
 * vez de strings, y `cn()` las descartaría sin error (las tarjetas del riel
 * perderían el ancho). Importalas siempre desde acá.
 */

/** Clases del contenedor en el riel (sólo por debajo de lg). */
export const MOBILE_RAIL =
  "max-lg:flex max-lg:snap-x max-lg:snap-mandatory max-lg:gap-3 max-lg:overflow-x-auto max-lg:overscroll-x-contain " +
  // pt-2/pb-1: un scroller horizontal recorta en su caja; sin ese aire se comía el
  // borde de arriba, la sombra y el anillo de foco de las tarjetas.
  "max-lg:pt-2 max-lg:pb-1 max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden " +
  // Sangrado hasta el borde de la pantalla: mismo padding que los contenedores de página (px-4 / sm:px-6).
  "max-sm:-mx-4 max-sm:px-4 max-sm:scroll-px-4 sm:max-lg:-mx-6 sm:max-lg:px-6 sm:max-lg:scroll-px-6";

/** Clases de cada tarjeta del riel (sólo por debajo de lg): 80 % del ancho, con tope. */
export const MOBILE_RAIL_ITEM = "max-lg:w-[80%] max-lg:max-w-[22rem] max-lg:shrink-0 max-lg:snap-start";
