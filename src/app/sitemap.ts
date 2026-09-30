import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";
import { getStorefrontSlugs } from "@/lib/marketplace/storefront";

/**
 * Sitemap de la web pública (www.apartcba.com): las páginas fijas y una
 * entrada por unidad de la vidriera (/u/{slug}). Sólo la vidriera: nada de
 * organizaciones demo ni de otras marcas del mismo dominio (rentOS).
 * La lista de slugs sale del catálogo cacheado (5 min, tag
 * `storefront-catalog`). Ante un error devuelve al menos las páginas fijas
 * para no romper el rastreo.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getAppUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/buscar`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/como-reservar`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/propietarios`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/legal/terminos`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/legal/privacidad`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const slugs = await getStorefrontSlugs();
    const listingRoutes: MetadataRoute.Sitemap = slugs.map((slug) => ({
      url: `${base}/u/${encodeURIComponent(slug)}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
    return [...staticRoutes, ...listingRoutes];
  } catch (err) {
    console.error("[sitemap] no se pudo leer la vidriera", err);
    return staticRoutes;
  }
}
