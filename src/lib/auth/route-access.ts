/**
 * Qué pantallas puede abrir el rol "Propietario" (owner_view).
 *
 * El dashboard no chequea `can()` en cada page y las Server Actions tampoco,
 * así que un propietario que tipea /dashboard/caja o /dashboard/huespedes
 * llegaba igual. Lista blanca (no lista negra): una pantalla nueva queda
 * cerrada para el propietario hasta que alguien la habilite a conciencia.
 *
 * Sin dependencias: lo importan el proxy y los layouts.
 */

/** Header con la ruta pedida; lo setea src/proxy.ts (pisa lo que mande el cliente). */
export const PATHNAME_HEADER = "x-apartcba-pathname";

const OWNER_EXACT = new Set([
  "/dashboard",
  "/dashboard/reservas",
  "/dashboard/liquidaciones",
  "/dashboard/perfil",
]);

const OWNER_PREFIXES = [
  "/dashboard/unidades/kanban", // Calendario
  "/dashboard/unidades/calendario", // Calendario mensual
  "/dashboard/reservas/", // detalle de SUS reservas (getBooking filtra)
  "/dashboard/perfil/",
];

/** Detalle de liquidación: /dashboard/liquidaciones/<uuid> (no /periodo). */
const SETTLEMENT_DETAIL = /^\/dashboard\/liquidaciones\/[0-9a-f-]{36}\/?$/i;

export function isPathAllowedForOwner(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (OWNER_EXACT.has(path)) return true;
  if (SETTLEMENT_DETAIL.test(path)) return true;
  return OWNER_PREFIXES.some((p) => path.startsWith(p));
}
