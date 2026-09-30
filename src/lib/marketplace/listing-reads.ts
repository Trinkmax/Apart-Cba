import "server-only";

import type { StorefrontListingDetail } from "./contracts";
import { getStorefrontListingBySlug } from "./storefront";

/**
 * Lecturas de fichas de la web pública.
 *
 * La implementación vive en `storefront.ts`: scope de vidriera (unidad
 * publicada, activa, con slug y precio, de una organización que vende en la
 * web), `monthly_price` resuelto con `unitMonthlyPrice()` y los campos de
 * display. Este módulo queda por compatibilidad con los imports de antes.
 */
export { rowToSummary, UNIT_SUMMARY_COLUMNS, type UnitRow } from "./catalog";

/**
 * Ficha de `/u/[slug]`; null si no existe o no está en la vidriera.
 * Deduplicada por request (`React.cache` en `getStorefrontListingBySlug`):
 * `generateMetadata` y la página comparten una sola lectura.
 */
export async function getListingBySlug(slug: string): Promise<StorefrontListingDetail | null> {
  return getStorefrontListingBySlug(slug);
}
