import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";

/**
 * robots.txt de la web pública. Se rastrea la vidriera (home, búsqueda,
 * fichas, páginas informativas) y se bloquea todo lo privado: cuenta del
 * huésped, pedidos y links de seguimiento (llevan un token), panel del
 * equipo, links de liquidación y autenticación.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/mi-cuenta",
        "/favoritos",
        "/checkout",
        "/reserva/",
        "/liquidacion/",
        "/dashboard",
        "/superadmin",
        "/m/",
        "/api/",
        "/auth/",
        "/login",
        "/ingresar",
        "/registrarse",
        "/reset-password",
        "/setup",
        "/sin-acceso",
        "/cancel-email-change",
        "/confirm-email-change",
        // El alta de rentOS no aporta nada al índice y compite con su landing.
        "/rentos/probar",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
