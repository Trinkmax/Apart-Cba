import type { ChannelLinkHealth, ChannelLinkRow } from "./types";

/**
 * Salud derivada de una conexión — SIEMPRE calculada desde datos reales:
 *
 *   healthy   → último poll OK hace ≤10 min, sin fallos acumulados
 *   degraded  → 10-30 min sin éxito, o 1-2 errores consecutivos
 *   critical  → >30 min sin éxito, ≥3 errores consecutivos, o incidencia
 *               crítica abierta (el caller la pasa por hasCriticalIssue)
 *   verifying → activa pero la OTA todavía no consultó el calendario saliente
 *   paused / draft → estados explícitos
 *
 * Nota honesta: que la OTA haya consultado el calendario demuestra acceso al
 * enlace; NO garantiza cuándo aplica los cambios. La UI mantiene esa distinción.
 */
export function computeLinkHealth(
  link: Pick<
    ChannelLinkRow,
    "status" | "last_success_at" | "consecutive_failures" | "last_export_access_at"
  >,
  opts: { hasCriticalIssue?: boolean } = {},
): ChannelLinkHealth {
  if (link.status === "draft") return "draft";
  if (link.status === "paused") return "paused";
  if (opts.hasCriticalIssue) return "critical";
  if (link.status === "error") return "critical";

  const failures = link.consecutive_failures ?? 0;
  const lastOk = link.last_success_at ? Date.parse(link.last_success_at) : null;
  const minutesSinceOk = lastOk === null ? Infinity : (Date.now() - lastOk) / 60_000;

  if (failures >= 3 || minutesSinceOk > 30) return "critical";
  if (failures >= 1 || minutesSinceOk > 10) return "degraded";
  if (!link.last_export_access_at) return "verifying";
  return "healthy";
}

export const HEALTH_LABEL: Record<ChannelLinkHealth, string> = {
  healthy: "Conectada",
  degraded: "Degradada",
  critical: "Crítica",
  verifying: "Esperando verificación",
  paused: "Pausada",
  draft: "Borrador",
};
