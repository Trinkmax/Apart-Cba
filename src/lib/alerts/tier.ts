/**
 * Nivel de una notificación de la campana.
 *
 *  · "accion"  — hay algo para hacer (warning / critical). Es lo único que
 *    cuenta para el número rojo de la campana.
 *  · "novedad" — para enterarse (info / success): "Nueva reserva de Booking",
 *    "Limpieza programada". Se lista, pero no alarma, y se archiva sola
 *    (ver NOVEDAD_TTL_DAYS en policy.ts).
 *
 * Por qué: el número rojo contaba todo. Apart CBA tenía 88 "Limpieza
 * programada" sin leer y la campana marcaba 99+; un número que nunca baja
 * enseña a no mirarlo, y lo urgente se pierde entre lo informativo.
 *
 * Módulo aparte y sin dependencias: lo importan componentes de cliente.
 */
export type AlertTier = "accion" | "novedad";

export function notificationTier(severity: string | null | undefined): AlertTier {
  return severity === "warning" || severity === "critical" ? "accion" : "novedad";
}

/** Severidades que cuentan para el número de la campana. */
export const ACTIONABLE_SEVERITIES = ["warning", "critical"] as const;
