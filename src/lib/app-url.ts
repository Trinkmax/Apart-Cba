/**
 * URL pública base de la app, sin barra final ni espacios o saltos de línea.
 *
 * En producción `NEXT_PUBLIC_APP_URL` llegó con un "\n" al final: cada <loc>
 * del sitemap quedaba partido en dos líneas ("https://www.apartcba.com\n/u/…")
 * y el `Sitemap:` de robots.txt también. Todo lo que arme una URL absoluta
 * (sitemap, robots, metadata, emails, redirects de auth) pasa por acá.
 */

export const DEFAULT_APP_URL = "https://www.apartcba.com";

/** Normaliza un valor crudo de URL base. Vacío → el dominio productivo. */
export function normalizeAppUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return value || DEFAULT_APP_URL;
}

/** URL base de la app (sirve en server y en client: la var es NEXT_PUBLIC_). */
export function getAppUrl(): string {
  return normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
}

/** URL absoluta para un path de la app ("/u/slug" → "https://…/u/slug"). */
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${getAppUrl()}${clean}`;
}
