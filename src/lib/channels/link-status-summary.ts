import { HEALTH_LABEL } from "./health";
import { intervalLabel, stayLabel, type PublicationState } from "./export-reads";
import { formatTimeInTz, OTA_REFRESH_HINT } from "./publication-copy";
import type { Channel, ChannelLinkHealth } from "./types";
import { unitDisplay } from "./unit-label";

/**
 * El estado de una conexión dicho en frases, para quien pregunta en vez de
 * mirar la pantalla (Tex). Mismo contenido que la tabla de Canales: si la OTA
 * ya leyó lo que se cargó, qué le falta leer y cuándo lo va a ver, y si su
 * calendario se puede leer. Puro.
 *
 * El 18/11/2026 Viaggiato le preguntó a Tex por qué SALGUERO figuraba cerrado
 * en las OTAs y la respuesta fue «no alcanza para explicarlo»: no tenía de
 * dónde sacarlo.
 */
export interface LinkStatusInput {
  id: string;
  channel: Channel;
  status: string;
  unit: { id: string; code: string; name: string };
  health_state: ChannelLinkHealth;
  feed_secret_id: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_export_access_at: string | null;
  export_interval_min?: number | null;
  health: Record<string, unknown>;
  publication: PublicationState | null;
  open_issues: number;
}

export interface LinkStatusSummary {
  id: string;
  unidad: string;
  canal: string;
  estado: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
  /** Si la OTA leyó nuestro calendario, y qué le falta. */
  publicacion: string;
  /** Noches ocupadas acá que la OTA todavía muestra libres. */
  le_falta_cerrar: string[];
  /** Noches que acá se liberaron y la OTA sigue cerrando. */
  le_falta_liberar: string[];
  /** Si podemos leer el calendario de la OTA. */
  recepcion: string;
  /** Cómo pedirle a la OTA que lea ya (sólo si hay algo que no vio). */
  como_forzar: string | null;
  avisos_abiertos: number;
  /** Hay algo para mirar: no está simplemente al día. */
  needsAttention: boolean;
}

const TONE: Record<ChannelLinkHealth, LinkStatusSummary["tone"]> = {
  healthy: "good",
  degraded: "warn",
  critical: "bad",
  unread: "bad",
  verifying: "info",
  paused: "neutral",
  draft: "neutral",
};

export function summarizeLinkStatus(link: LinkStatusInput, now: Date = new Date()): LinkStatusSummary {
  const ota = link.channel === "airbnb" ? "Airbnb" : "Booking";
  const pace = intervalLabel(link.export_interval_min ?? null);
  const p = link.publication;
  const toBlock = p?.changes.toBlock ?? [];
  const toRelease = p?.changes.toRelease ?? [];
  const read = link.last_export_access_at ? agoLabel(link.last_export_access_at, now) : null;

  let publicacion: string;
  if (!p) {
    publicacion =
      link.status === "paused" ? "La conexión está en pausa." : "La conexión no se terminó de armar.";
  } else if (p.kind === "waiting") {
    publicacion = `${ota} todavía no leyó tu calendario (la conexión es reciente).`;
  } else if (p.kind === "never") {
    publicacion = `${ota} nunca leyó tu calendario: lo que se reserva acá no se cierra en ${ota}. Falta pegar el enlace de rentOS en el anuncio.`;
  } else if (p.kind === "stale") {
    publicacion = `${ota} no lee tu calendario desde ${read ?? "hace días"}: lo que se reserva acá no se cierra en ${ota}.`;
  } else if (p.kind === "pending") {
    const n = toBlock.length + toRelease.length;
    const when = p.nextReadAt
      ? `lo ve a eso de las ${formatTimeInTz(p.nextReadAt, now)}`
      : pace
        ? `lee ${pace}`
        : "lo ve en su próxima lectura";
    publicacion = `${ota} leyó ${read ?? "hace un rato"} y todavía no vio ${n === 1 ? "un cambio" : `${n} cambios`}; ${when}.`;
  } else {
    publicacion = `${ota} está al día: leyó ${read ?? "hace un rato"}${pace ? ` y lee ${pace}` : ""}.`;
  }

  let recepcion: string;
  const lastError = typeof link.health?.last_error === "string" ? link.health.last_error : null;
  if (!link.feed_secret_id) {
    recepcion = `No tiene cargado el calendario de ${ota}: sus reservas no entran.`;
  } else if (link.status === "paused") {
    recepcion = "En pausa: no se leen sus reservas.";
  } else if (link.consecutive_failures > 0) {
    recepcion = `No se puede leer el calendario de ${ota}: ${link.consecutive_failures} ${link.consecutive_failures === 1 ? "intento fallido" : "intentos fallidos seguidos"}${lastError ? ` (${lastError})` : ""}. Sus reservas no están entrando.`;
  } else if (link.last_success_at) {
    recepcion = `Sus reservas se leen bien (${agoLabel(link.last_success_at, now)})${link.health?.last_events === 0 ? "; hoy su calendario no trae ninguna" : ""}.`;
  } else {
    recepcion = `Todavía no se leyó el calendario de ${ota}.`;
  }

  const unseen = toBlock.length + toRelease.length > 0;
  return {
    id: link.id,
    unidad: unitDisplay(link.unit.code, link.unit.name),
    canal: ota,
    estado: HEALTH_LABEL[link.health_state],
    tone: unseen && link.health_state === "healthy" ? "warn" : TONE[link.health_state],
    publicacion,
    le_falta_cerrar: toBlock.map(stayLabel),
    le_falta_liberar: toRelease.map(stayLabel),
    recepcion,
    como_forzar: unseen ? OTA_REFRESH_HINT[link.channel] : null,
    avisos_abiertos: link.open_issues,
    needsAttention:
      link.status === "active" &&
      (unseen ||
        link.open_issues > 0 ||
        link.health_state === "critical" ||
        link.health_state === "degraded" ||
        link.health_state === "unread"),
  };
}

/** «recién», «hace 12 min», «hace 3 h», «hace 13 días». */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "hace un rato";
  const min = Math.max(0, Math.round((now.getTime() - at) / 60_000));
  if (min < 2) return "recién";
  if (min < 90) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 36) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}
