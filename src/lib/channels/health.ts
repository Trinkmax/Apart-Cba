import { NEVER_READ_GRACE_MS, READER_STALE_MS } from "./export-reads";
import type { ChannelLinkHealth, ChannelLinkRow } from "./types";

/**
 * Salud derivada de una conexión — SIEMPRE calculada desde datos reales:
 *
 *   healthy   → último poll OK hace ≤10 min, sin fallos acumulados
 *   degraded  → 10-30 min sin éxito, o 1-2 errores consecutivos
 *   critical  → >30 min sin éxito, ≥3 errores consecutivos, o incidencia
 *               crítica abierta (el caller la pasa por hasCriticalIssue)
 *   unread    → la OTA no lee nuestro calendario: dejó de leerlo hace más de un
 *               día (lee cada 2-3 horas), o pasaron dos días de conectada y
 *               nunca lo leyó. Lo que se reserva acá no se cierra allá.
 *   verifying → recién conectada: la OTA todavía no consultó el calendario
 *   paused / draft → estados explícitos
 *
 * Nota honesta: que la OTA haya consultado el calendario demuestra acceso al
 * enlace; NO garantiza cuándo aplica los cambios. La UI mantiene esa distinción.
 *
 * `unread` existe desde el 19/11/2026. Antes, la única señal del lado saliente
 * era "nunca consultó", y nunca dejaba de ser azul: en Viaggiato, CARLUCCI y
 * FRIAS llevaban tres semanas «Esperando verificación» y JARDINES figuraba
 * «Conectada» con Airbnb sin leer desde hacía trece días.
 */
export function computeLinkHealth(
  link: Pick<
    ChannelLinkRow,
    "status" | "last_success_at" | "consecutive_failures" | "last_export_access_at"
  > &
    Partial<Pick<ChannelLinkRow, "created_at">>,
  opts: { hasCriticalIssue?: boolean } = {},
): ChannelLinkHealth {
  if (link.status === "draft") return "draft";
  if (link.status === "paused") return "paused";
  if (opts.hasCriticalIssue) return "critical";
  if (link.status === "error") return "critical";

  const failures = link.consecutive_failures ?? 0;
  const lastOk = link.last_success_at ? Date.parse(link.last_success_at) : null;
  const minutesSinceOk = lastOk === null ? Infinity : (Date.now() - lastOk) / 60_000;

  // Umbral de "degradada" = 15 min: cada conexión se sondea cada 5 min, pero el
  // dispatcher corre cada 2 min (pg_cron) y una corrida puede saltearse. Con
  // 10 min bastaba UN tick perdido para pintar toda la operación en ámbar sin
  // que nada estuviera mal. 15 min sigue avisando mucho antes que "crítica" (30).
  if (failures >= 3 || minutesSinceOk > 30) return "critical";
  if (failures >= 1 || minutesSinceOk > 15) return "degraded";

  if (!link.last_export_access_at) {
    const since = link.created_at ? Date.parse(link.created_at) : NaN;
    const waited = Number.isNaN(since) ? 0 : Date.now() - since;
    return waited > NEVER_READ_GRACE_MS ? "unread" : "verifying";
  }
  const lastRead = Date.parse(link.last_export_access_at);
  if (!Number.isNaN(lastRead) && Date.now() - lastRead > READER_STALE_MS) return "unread";
  return "healthy";
}

export const HEALTH_LABEL: Record<ChannelLinkHealth, string> = {
  healthy: "Conectada",
  degraded: "Degradada",
  critical: "Crítica",
  unread: "La OTA no lee",
  verifying: "Esperando verificación",
  paused: "Pausada",
  draft: "Borrador",
};
