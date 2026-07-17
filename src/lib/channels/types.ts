/**
 * Canales de venta v2 — tipos del dominio.
 *
 * Un ReservationEvent es la representación normalizada de "algo pasó en una
 * OTA" sin importar el transporte (iCal o email). Ambos transportes producen
 * este mismo shape y pasan por el MISMO servicio de ingestión (ingest.ts) —
 * nunca escriben bookings por caminos separados.
 */

export type Channel = "airbnb" | "booking";
export type ChannelTransport = "ical" | "email";
export type ChannelLinkStatus = "draft" | "active" | "paused" | "error";
export type ChannelEventStatus =
  | "received"
  | "processing"
  | "processed"
  | "needs_review"
  | "error";

export interface ReservationEvent {
  transport: ChannelTransport;
  channel: Channel;
  eventType: "reservation_upsert" | "reservation_cancelled";
  organizationId: string;
  /** Conexión de origen — conocida para iCal, ausente para email. */
  linkId?: string;
  /** Unidad ya resuelta por el transporte (iCal la conoce por la conexión). */
  unitId?: string;
  icalUid?: string;
  /** Código de confirmación (Airbnb HM… / número de reserva de Booking). */
  confirmationCode?: string;
  checkIn?: string; // YYYY-MM-DD (half-open [checkIn, checkOut))
  checkOut?: string;
  /**
   * true = el evento solo ocupa calendario (Booking.com iCal no distingue
   * reserva de bloqueo). Protege disponibilidad sin contaminar reportes;
   * un email posterior lo "asciende" a reserva real.
   */
  isBlock?: boolean;
  guest?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  /** Importes informados por la OTA — metadata externa, JAMÁS pisa finanzas. */
  amounts?: { total?: number; currency?: string };
  /** Listing externo si el email lo trae (para mapping determinista). */
  listingId?: string;
  /** Texto libre del listing — SOLO para sugerencias, nunca auto-asigna. */
  listingHint?: string;
  /** Clave de idempotencia dura (org-scoped). */
  dedupeKey: string;
  /** SHA-256 del contenido original, para auditoría sin guardar raw bodies. */
  contentHash?: string;
}

export interface IngestResult {
  outcome:
    | "created"
    | "updated"
    | "cancelled"
    | "duplicate"
    | "conflict"
    | "needs_review"
    | "error";
  bookingId?: string;
  reservationId?: string;
  issueId?: string;
  error?: string;
}

export interface ChannelLinkRow {
  id: string;
  organization_id: string;
  unit_id: string;
  channel: Channel;
  status: ChannelLinkStatus;
  label: string | null;
  external_listing_id: string | null;
  external_listing_url: string | null;
  feed_secret_id: string | null;
  export_token_hash: string | null;
  export_secret_id: string | null;
  remote_etag: string | null;
  remote_last_modified: string | null;
  next_poll_at: string;
  claimed_until: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_reservation_at: string | null;
  last_export_access_at: string | null;
  health: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChannelReservationRow {
  id: string;
  organization_id: string;
  link_id: string | null;
  unit_id: string | null;
  channel: Channel;
  booking_id: string | null;
  external_status: "active" | "cancelled";
  check_in: string | null;
  check_out: string | null;
  ical_uid: string | null;
  confirmation_code: string | null;
  guest: { name?: string; email?: string; phone?: string; phone_raw?: string };
  amounts: { total?: number; currency?: string };
  missing_since: string | null;
  missing_runs: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ChannelIssueType =
  | "conflict"
  | "unmapped_unit"
  | "ambiguous_unit"
  | "feed_error"
  | "parse_error"
  | "cancellation_review"
  | "email_error"
  | "stale_link";

export interface ChannelIssueRow {
  id: string;
  organization_id: string;
  link_id: string | null;
  event_id: string | null;
  reservation_id: string | null;
  booking_id: string | null;
  issue_type: ChannelIssueType;
  severity: "info" | "warning" | "critical";
  status: "open" | "resolved" | "dismissed";
  title: string;
  detail: string | null;
  suggested: Record<string, unknown>;
  dedupe_key: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Salud derivada de una conexión — calculada desde datos reales, no guardada.
 *   healthy   → último poll OK dentro de 10 min y sin incidencias críticas
 *   degraded  → 10-30 min sin éxito, o 1-2 errores consecutivos
 *   critical  → >30 min sin éxito, ≥3 errores consecutivos, o conflicto abierto
 *   verifying → el calendario saliente todavía no fue consultado por la OTA
 *   paused    → desactivada explícitamente
 *   draft     → asistente sin terminar
 */
export type ChannelLinkHealth =
  | "healthy"
  | "degraded"
  | "critical"
  | "verifying"
  | "paused"
  | "draft";

/** Adaptador de transporte: obtiene y normaliza eventos de una conexión. */
export interface ChannelTransportAdapter {
  /**
   * Trae el estado remoto de la conexión y lo normaliza. `snapshot.complete`
   * indica una lectura completa y exitosa (habilita el diff de desapariciones).
   */
  fetchReservations(input: {
    feedUrl: string;
    etag?: string | null;
    lastModified?: string | null;
  }): Promise<IcalFetchOutcome>;
}

export interface IcalFetchOutcome {
  status: "ok" | "not_modified" | "http_error" | "parse_error" | "blocked_url";
  httpStatus?: number;
  error?: string;
  etag?: string | null;
  lastModified?: string | null;
  /** Eventos normalizados (solo con status ok). */
  events?: NormalizedIcalEvent[];
  /** Horizonte confiable del feed: mayor DTEND visto (YYYY-MM-DD). */
  horizon?: string | null;
}

export interface NormalizedIcalEvent {
  uid: string;
  checkIn: string;
  checkOut: string;
  summary: string;
  /** true = bloqueo/ocupación sin datos de reserva. */
  isBlock: boolean;
  confirmationCode?: string;
  phoneLast4?: string;
}
