import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Sitemap del marketplace público. Incluye las rutas estáticas y una entrada
 * por cada unidad publicada (/u/{slug}). Ante cualquier error devolvemos al
 * menos las rutas estáticas para no romper el crawl.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.apartcba.com";

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: base,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${base}/buscar`,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("units")
      .select("slug, updated_at")
      .eq("marketplace_published", true)
      .eq("active", true)
      .not("slug", "is", null);

    if (error || !data) {
      return staticRoutes;
    }

    const listingRoutes: MetadataRoute.Sitemap = data
      .filter((unit): unit is { slug: string; updated_at: string | null } =>
        Boolean(unit.slug)
      )
      .map((unit) => ({
        url: `${base}/u/${unit.slug}`,
        ...(unit.updated_at ? { lastModified: new Date(unit.updated_at) } : {}),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));

    return [...staticRoutes, ...listingRoutes];
  } catch {
    return staticRoutes;
  }
}
