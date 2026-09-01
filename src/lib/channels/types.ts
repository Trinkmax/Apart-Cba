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
export type ChannelReservationStatus =
  | "active"
  | "pending"
  | "cancelled"
  | "ignored"
  | "expired";
/**
 * De dónde salió la evidencia de que la solicitud era una reserva de verdad.
 *   email          → llegó la confirmación de la OTA
 *   email_backfill → la confirmación había llegado ANTES que el iCal (pasa
 *                    seguido: el mail de Airbnb gana la carrera por 3-5 min)
 *   manual         → alguien apretó "Es una reserva"
 *   ttl            → seguía publicada pasado el umbral y el mail nunca llegó
 *   gate_off       → se apagó la política y lo que quedó en vuelo se drenó a
 *                    reserva (si no, quedaría colgado hasta 26 h justo cuando
 *                    alguien apagó el gate porque algo estaba mal)
 */
export type ChannelPromotionSource =
  | "email"
  | "email_backfill"
  | "manual"
  | "ttl"
  | "gate_off";
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
  /**
   * `reservation_reference` no crea ni cancela nada: sólo aporta el número de
   * reserva de la OTA para una llegada conocida. Existe porque el aviso
   * "¡Nueva reserva!" de Booking llega ~5 min ANTES que el iCal y es el único
   * lugar donde el número y la fecha viajan juntos — sin él, una reserva
   * proyectada por iCal nunca tiene número y la cancelación por email no la
   * encuentra. Ver processReference en ingest.ts.
   */
  eventType: "reservation_upsert" | "reservation_cancelled" | "reservation_reference";
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
  /**
   * Evidencia POSITIVA de que la OTA confirmó la reserva. Lo setea únicamente
   * el adaptador de email en la rama `new_booking` (email-adapter.ts).
   *
   * El iCal NUNCA lo pone: en el feed de Airbnb una solicitud pendiente y una
   * reserva confirmada son el mismo VEVENT ("SUMMARY:Reserved" + código HM en
   * la DESCRIPTION) — verificado descargando los .ics de producción.
   *
   * Tampoco puede usarse `transport === "email"` como discriminante:
   * `reprojectReservation()` fabrica un evento sintético con transport "email",
   * y lo disparan los botones "Reintentar" y "Asignar unidad" de una incidencia.
   * Con ese atajo, un operador resolviendo una incidencia promovería un fantasma.
   */
  confirmed?: boolean;
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
    /** Solicitud registrada sin confirmar: NO se escribió nada en `bookings`. */
    | "requested"
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

/**
 * Fila que devuelve el RPC `channels_claim_due_links_v2` (migración 056): la
 * conexión reclamada MÁS la URL del feed ya desencriptada desde Vault, para no
 * pagar un round trip a `crm_get_secret` por conexión. `feed_url` es null si la
 * conexión no tiene secreto o el secreto no existe en Vault.
 */
export type ClaimedChannelLink = ChannelLinkRow & { feed_url: string | null };

export interface ChannelReservationRow {
  id: string;
  organization_id: string;
  link_id: string | null;
  unit_id: string | null;
  channel: Channel;
  booking_id: string | null;
  /**
   * active    → vigente en la OTA y proyectada a `bookings`
   * pending   → SOLICITUD sin confirmar. La fila existe y se ve, pero NO hay
   *             fila en `bookings`: no ocupa calendario, no dispara limpiezas,
   *             no entra a KPIs ni liquidaciones. En el feed de Airbnb una
   *             solicitud y una reserva confirmada son el MISMO VEVENT, así que
   *             el único ascenso posible es evidencia positiva externa
   *             (`promoted_source`).
   * cancelled → la OTA la sacó del calendario
   * ignored   → el operador la liberó a mano desde el PMS. NO se re-proyecta
   *             aunque el VEVENT siga vivo en el feed (decisión humana, no un
   *             hecho de la OTA). Solo un email de reserva real la reactiva.
   * expired   → solicitud que desapareció del feed sin confirmarse. Nunca fue
   *             reserva, así que se descarta sola (no aplica la 053, que exige
   *             humano para cancelar una RESERVA). Reversible desde la UI.
   */
  external_status: ChannelReservationStatus;
  check_in: string | null;
  check_out: string | null;
  ical_uid: string | null;
  confirmation_code: string | null;
  /** true = cierre de fechas, no una reserva — ver ReservationEvent.isBlock. */
  is_block: boolean;
  guest: { name?: string; email?: string; phone?: string; phone_raw?: string };
  amounts: { total?: number; currency?: string };
  missing_since: string | null;
  missing_runs: number;
  last_seen_at: string | null;
  ignored_at: string | null;
  ignored_by: string | null;
  ignored_reason: string | null;
  /**
   * Una persona miró la ausencia en el feed y decidió MANTENER la reserva. El
   * barrido no vuelve a proponer cancelarla por desaparición (una cancelación
   * formal por email de la OTA sí sigue su camino).
   */
  cancellation_locked_at: string | null;
  cancellation_locked_by: string | null;
  /** Cuándo y por qué dejó de ser solicitud. Null mientras siga `pending`. */
  promoted_at: string | null;
  promoted_source: ChannelPromotionSource | null;
  promoted_by: string | null;
  expired_at: string | null;
  /**
   * Quién la descartó: el feed (automático, revive si el VEVENT vuelve) o una
   * persona (no revive sola — mismo principio que `ignored`).
   */
  expired_source: "feed" | "manual" | null;
  expired_by: string | null;
  /** Último intento FALLIDO de proyectar la solicitud (throttle del reintento). */
  projection_attempted_at: string | null;
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
  /** true = cierre de fechas, no una reserva. Hoy sólo lo marca el operador
   *  desde el PMS: ningún feed lo informa (el de Booking no distingue). */
  isBlock: boolean;
  confirmationCode?: string;
  phoneLast4?: string;
}
