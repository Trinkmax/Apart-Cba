import type { MetadataRoute } from "next";

/**
 * robots.txt del marketplace público. Permitimos el crawl general pero
 * bloqueamos las rutas privadas del huésped y del staff.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.apartcba.com";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/mi-cuenta",
        "/checkout",
        "/dashboard",
        "/superadmin",
        "/m",
        "/api",
        "/ingresar",
        "/registrarse",
        "/reset-password",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
