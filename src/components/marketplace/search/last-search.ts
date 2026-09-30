/**
 * La última búsqueda de la pestaña (sessionStorage), para que "← Seguir
 * buscando" en una ficha vuelva a /buscar con las mismas fechas, huéspedes,
 * barrio y filtros. `document.referrer` no sirve: no cambia en las
 * navegaciones del lado del cliente de Next.
 *
 * Todo con try/catch: sin storage (navegación privada, bloqueado) la ficha
 * cae a /buscar con las fechas de su propia URL.
 */
const KEY = "apart:ultima-busqueda";

export function rememberLastSearch(href: string): void {
  try {
    if (href.startsWith("/buscar")) window.sessionStorage.setItem(KEY, href);
  } catch {
    // Sin storage: no pasa nada.
  }
}

export function readLastSearch(): string | null {
  try {
    const href = window.sessionStorage.getItem(KEY);
    // Sólo rutas propias de búsqueda (nunca una URL externa guardada a mano).
    return href && /^\/buscar(?:[?#]|$)/.test(href) ? href : null;
  } catch {
    return null;
  }
}

/** /buscar con las fechas y huéspedes que trae la URL de la ficha (si los hay). */
export function searchHrefFromListingQuery(search: string): string {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  for (const key of ["checkin", "checkout", "huespedes"]) {
    const value = from.get(key);
    if (value) to.set(key, value);
  }
  const q = to.toString();
  return q ? `/buscar?${q}` : "/buscar";
}
