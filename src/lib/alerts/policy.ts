import { isBookingWindowMarker } from "@/lib/channels/booking-window";
import { looksLikeReservationEmail } from "@/lib/channels/email-noise";
import { notificationTier } from "./tier";

export { notificationTier, ACTIONABLE_SEVERITIES, type AlertTier } from "./tier";

/**
 * Política de avisos: qué le aparece a una persona como "algo para resolver".
 *
 * Un aviso tiene que ganarse su lugar. Pasa tres preguntas, y la respuesta vive
 * acá y en ningún otro lado:
 *
 *  1. ¿Alguien puede hacer algo? Si no, queda registrado pero no se muestra
 *     (los mails que no son reservas, el seguimiento de una reserva que faltó
 *     en UNA lectura del feed).
 *  2. ¿Ya esperamos lo suficiente? Lo transitorio se muestra recién si dura:
 *     el mail que le gana al iCal por 3-5 minutos, el feed que falla un rato y
 *     vuelve. Si se arregla solo en ese margen, nadie lo vio.
 *  3. ¿Sigue siendo verdad? Lo que dejó de aplicar se cierra solo: fechas
 *     pasadas, cuota cobrada, conexión que volvió, limpieza hecha. Lo hace el
 *     barrido diario (sweep.ts) con estas mismas funciones.
 *
 * Origen (12/11/2026): Antonella (Viaggiato) dijo que el sistema "todo el
 * tiempo tira errores". Tenía 31 incidencias abiertas en Canales y 28 eran
 * ruido. Apart CBA tenía 108 "Email de OTA no reconocido" abiertos y la campana
 * en 99+. Un aviso que no se puede resolver, o que nunca se va, enseña a
 * ignorarlos a todos.
 *
 * Todo es puro (sin base): el barrido junta los hechos y estas funciones
 * deciden. Los tests están en __tests__/policy.test.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Notificaciones (campana)
// ─────────────────────────────────────────────────────────────────────────────

/** Una novedad (info / success) se archiva sola pasada esta edad. */
export const NOVEDAD_TTL_DAYS = 7;

export interface NotificationForPolicy {
  type: string;
  severity: string;
  ref_type: string | null;
  dedup_key: string | null;
  created_at: string;
  due_at?: string | null;
}

/**
 * Lo que el barrido averiguó sobre aquello a lo que apunta la notificación.
 * `undefined` = no aplica o no se miró; `null` = ya no existe.
 */
export interface NotificationFacts {
  cleaningTask?: { status: string; scheduledYmd: string } | null;
  dailyReport?: { status: string; reportYmd: string } | null;
  booking?: { status: string; checkInYmd: string } | null;
  paymentSchedule?: {
    status: string;
    bookingStatus: string | null;
    /** La reserva ya está cobrada entera (lo cobrado cubre el total). */
    bookingPaid?: boolean;
  } | null;
  /** Reserva externa que se dio por confirmada sola (TTL): ¿sigue por llegar? */
  autoConfirmedReservation?: { externalStatus: string; checkInYmd: string | null } | null;
  /** Pedido de la web propia que espera respuesta. */
  bookingRequest?: { status: string; checkInYmd: string | null } | null;
  channelReservation?: { externalStatus: string } | null;
  conflictStillOpen?: boolean;
  cancellationRequestPending?: boolean;
  emailForwardingVerified?: boolean;
}

/**
 * Avisos de algo que YA pasó ("La reserva X se canceló en la OTA"): no piden
 * nada, aunque hayan nacido como warning. Se archivan a esta edad (días).
 */
const INFORMATIVE_TTL_DAYS: Record<string, number> = {
  inbound_booking_cancelled: 7,
};

const CLOSED_CLEANING = new Set(["completada", "verificada", "cancelada"]);
const DEAD_BOOKING = new Set(["cancelada", "no_show"]);

/**
 * ¿Hay que archivar esta notificación? Devuelve el motivo, o null si sigue
 * valiendo. Archivar = `dismissed_at`: sale de la campana, queda en el
 * historial de Alertas.
 */
export function notificationDismissReason(
  n: NotificationForPolicy,
  facts: NotificationFacts,
  opts: { today: string; now: Date },
): string | null {
  if (
    notificationTier(n.severity) === "novedad" &&
    // Un recordatorio que escribió una persona lo cierra una persona.
    n.type !== "manual" &&
    // "Seguro por vencer": vale hasta que la fecha pasa, no por su edad.
    !(n.due_at && Date.parse(n.due_at) >= opts.now.getTime() - 86_400_000) &&
    ageDays(n.created_at, opts.now) >= NOVEDAD_TTL_DAYS
  ) {
    return "novedad_vencida";
  }

  const informativeTtl = INFORMATIVE_TTL_DAYS[n.type];
  if (informativeTtl !== undefined && ageDays(n.created_at, opts.now) >= informativeTtl) {
    return "aviso_vencido";
  }

  if (n.ref_type === "cleaning_task" && facts.cleaningTask !== undefined) {
    const t = facts.cleaningTask;
    if (!t) return "limpieza_inexistente";
    if (CLOSED_CLEANING.has(t.status)) return "limpieza_cerrada";
    if (t.scheduledYmd < opts.today) return "limpieza_pasada";
  }

  if (n.ref_type === "daily_report" && facts.dailyReport !== undefined) {
    const r = facts.dailyReport;
    if (!r) return "parte_inexistente";
    if (r.status !== "borrador") return "parte_revisado";
    if (r.reportYmd < opts.today) return "parte_pasado";
  }

  if (n.type === "inbound_booking_pending" && facts.booking !== undefined) {
    const b = facts.booking;
    if (!b) return "reserva_inexistente";
    if (DEAD_BOOKING.has(b.status)) return "reserva_cancelada";
    if (b.checkInYmd < opts.today) return "reserva_ya_llego";
  }

  if (
    (n.type === "payment_due" || n.type === "payment_overdue") &&
    facts.paymentSchedule !== undefined
  ) {
    const s = facts.paymentSchedule;
    if (!s) return "cuota_inexistente";
    if (s.bookingStatus && DEAD_BOOKING.has(s.bookingStatus)) return "reserva_cancelada";
    if (s.status === "paid" || s.status === "cancelled") return "cuota_cerrada";
    // La cuota figura vencida pero la reserva está cobrada entera (hay orgs
    // que cobran sobre la reserva y no marcan cada cuota): no se debe nada.
    if (s.bookingPaid) return "reserva_pagada";
    // "Próximo cobro" que ya venció: lo reemplaza el aviso de cuota vencida.
    if (n.type === "payment_due" && s.status === "overdue") return "cuota_vencida_avisada";
  }

  if (n.type === "channel_request_pending" && facts.channelReservation !== undefined) {
    const r = facts.channelReservation;
    if (!r || r.externalStatus !== "pending") return "solicitud_resuelta";
  }

  if (
    n.type === "channel_request_auto_confirmed" &&
    facts.autoConfirmedReservation !== undefined
  ) {
    // "Verificá que sea real": deja de tener sentido cuando la fecha de
    // llegada pasó o la reserva ya no está activa.
    const r = facts.autoConfirmedReservation;
    if (!r || r.externalStatus !== "active") return "verificacion_vencida";
    if (r.checkInYmd && r.checkInYmd < opts.today) return "verificacion_vencida";
  }

  if (n.ref_type === "booking_request" && facts.bookingRequest !== undefined) {
    const r = facts.bookingRequest;
    if (!r || r.status !== "pendiente") return "pedido_resuelto";
    if (r.checkInYmd && r.checkInYmd < opts.today) return "pedido_vencido";
  }

  if (n.type === "inbound_booking_conflict" && facts.conflictStillOpen === false) {
    return "conflicto_resuelto";
  }

  if (
    n.type === "channel_cancellation_pending" &&
    facts.cancellationRequestPending === false
  ) {
    return "cancelacion_decidida";
  }

  if (n.dedup_key?.startsWith("gmail_forwarding:") && facts.emailForwardingVerified === true) {
    return "reenvio_confirmado";
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Incidencias de Canales ("Para resolver")
// ─────────────────────────────────────────────────────────────────────────────

export type IssueVisibility = "visible" | "esperando" | "seguimiento";

export interface IssueForPolicy {
  issue_type: string;
  dedupe_key: string | null;
  created_at: string;
}

/**
 * Margen antes de mostrar (minutos), por prefijo de dedupe_key. Si se resuelve
 * sola en ese tiempo, nadie la ve.
 */
const ISSUE_GRACE_MINUTES: ReadonlyArray<readonly [string, number]> = [
  // El mail de confirmación le gana al iCal por 3-5 min y Airbnb no manda el
  // id del anuncio: hasta que llega el iCal no hay cómo saber la unidad.
  ["unit:", 30],
  // Un feed que falla tres lecturas seguidas y se recupera solo (Booking
  // devuelve 400 un rato y vuelve).
  ["feed:", 120],
  // "Viniendo vacío" suele ser una lectura parcial; lo que protege el sistema
  // (no cancelar nada) ya pasó en silencio.
  ["empty_feed:", 360],
];

/**
 * Seguimiento, no acción: "si sigue ausente te vamos a pedir que decidas".
 * Todavía no hay nada que hacer; cuando lo haya, llega como pedido de
 * confirmación de cancelación.
 */
const SEGUIMIENTO_PREFIXES = ["missing:"];

export function issueVisibility(issue: IssueForPolicy, now: Date): IssueVisibility {
  const key = issue.dedupe_key ?? "";
  if (SEGUIMIENTO_PREFIXES.some((p) => key.startsWith(p))) return "seguimiento";
  const grace = ISSUE_GRACE_MINUTES.find(([p]) => key.startsWith(p))?.[1] ?? 0;
  if (grace > 0 && minutesSince(issue.created_at, now) < grace) return "esperando";
  return "visible";
}

/**
 * Lo que el barrido averiguó sobre aquello a lo que apunta la incidencia.
 * `undefined` = no aplica o no se miró; `null` = ya no existe.
 */
export interface IssueFacts {
  /** Último día de la estadía (check-out) de la reserva a la que apunta. */
  stayEndYmd?: string | null;
  /** Llegada (check-in) de la reserva externa a la que apunta. */
  stayStartYmd?: string | null;
  /** Canal de la reserva externa (airbnb | booking). */
  channel?: string | null;
  /** Cuándo entró esa reserva externa (YYYY-MM-DD): mide la distancia a la llegada. */
  reservationSeenYmd?: string | null;
  isBlock?: boolean;
  /** channel_reservations.external_status */
  reservationStatus?: string | null;
  /** bookings.status */
  bookingStatus?: string | null;
  link?: {
    status: string;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    anomalousEmpty: boolean;
    /** Última vez que la OTA leyó nuestro calendario por esta conexión. */
    lastExportAccessAt?: string | null;
  } | null;
  /** Reservas activas con salida de hoy en adelante, para el feed vacío. */
  linkActiveFutureReservations?: number;
  /** Asunto del mail que no se pudo leer. */
  emailSubject?: string | null;
  /** El código de la reserva ya está en una reserva con unidad. */
  codeOnReservationWithUnit?: boolean;
}

/**
 * ¿Hay que cerrar esta incidencia? Devuelve la resolución (texto que queda en
 * la incidencia) o null si sigue abierta.
 */
export function issueResolution(
  issue: IssueForPolicy,
  facts: IssueFacts,
  opts: { today: string; now: Date },
): string | null {
  const key = issue.dedupe_key ?? "";

  if (key.startsWith("email_unparsed:")) {
    if (typeof facts.emailSubject === "string" && !looksLikeReservationEmail(facts.emailSubject)) {
      return "Se archivó: el mail no era una reserva ni una cancelación.";
    }
    if (ageDays(issue.created_at, opts.now) >= 7) {
      return "Venció: tiene más de una semana, y la ocupación la trae el calendario de la OTA.";
    }
    return null;
  }

  if (key.startsWith("unit:")) {
    if (facts.codeOnReservationWithUnit) {
      return "La reserva ya está en el calendario: la trajo el calendario de la OTA.";
    }
    if (facts.stayEndYmd && facts.stayEndYmd < opts.today) {
      return "Las fechas de la reserva ya pasaron.";
    }
    return null;
  }

  // «La OTA no lee tu calendario»: deja de ser verdad cuando vuelve a leer.
  if (key.startsWith("export_stale:")) {
    const link = facts.link;
    if (link === undefined) return null;
    if (link === null) return "La conexión ya no existe.";
    if (link.status !== "active") return "La conexión está pausada.";
    if (link.lastExportAccessAt && minutesSince(link.lastExportAccessAt, opts.now) <= 24 * 60) {
      return "La OTA volvió a leer tu calendario.";
    }
    return null;
  }

  if (
    key.startsWith("feed:") ||
    key.startsWith("feed_gone:") ||
    key.startsWith("own_feed:") ||
    key.startsWith("stale:") ||
    key.startsWith("empty_feed:")
  ) {
    const link = facts.link;
    if (link === undefined) return null;
    if (link === null) return "La conexión ya no existe.";
    if (link.status !== "active") return "La conexión está pausada.";
    if (key.startsWith("empty_feed:")) {
      if (!link.anomalousEmpty) return "El calendario volvió a traer eventos.";
      if (facts.linkActiveFutureReservations === 0) {
        return "No quedan reservas futuras de esta conexión que proteger.";
      }
      return null;
    }
    if (
      link.consecutiveFailures === 0 &&
      link.lastSuccessAt &&
      minutesSince(link.lastSuccessAt, opts.now) <= 120
    ) {
      return "La conexión volvió a funcionar.";
    }
    return null;
  }

  // Lo que apunta a una reserva concreta. Sólo las incidencias operativas (que
  // un huésped no llegue a una unidad ocupada, que no se venda dos veces)
  // dejan de importar cuando la estadía terminó. Una reserva duplicada en el
  // sistema o con fechas distintas a las de la OTA sigue pesando en la
  // liquidación: ésas quedan hasta que alguien las mire.
  const operational = OPERATIONAL_RESERVATION_PREFIXES.some((p) => key.startsWith(p));
  if (operational && facts.stayEndYmd && facts.stayEndYmd < opts.today) {
    return "Las fechas ya pasaron.";
  }
  if (operational && facts.isBlock) return "Era un cierre de fechas, no una reserva.";
  if (
    operational &&
    facts.channel === "booking" &&
    facts.stayStartYmd &&
    facts.stayEndYmd &&
    facts.reservationSeenYmd &&
    isBookingWindowMarker(
      { checkIn: facts.stayStartYmd, checkOut: facts.stayEndYmd },
      facts.reservationSeenYmd,
    )
  ) {
    // Entró antes de que el lector del iCal reconociera las marcas de la
    // ventana de Booking (booking-window.ts): nunca fue una reserva.
    return "Era la marca del borde del calendario de Booking, no una reserva.";
  }
  if (
    key.startsWith("missing:") &&
    ((facts.reservationStatus && facts.reservationStatus !== "active") ||
      facts.bookingStatus === "cancelada")
  ) {
    return "La reserva ya no está activa en el sistema.";
  }
  if (
    (key.startsWith("conflict:") || key.startsWith("adopt_review:")) &&
    facts.reservationStatus &&
    ["cancelled", "ignored", "expired"].includes(facts.reservationStatus)
  ) {
    return "La OTA ya no informa esa reserva.";
  }
  if (key.startsWith("cancel_unknown:") && ageDays(issue.created_at, opts.now) >= 3) {
    return "Venció: no había una reserva en el sistema que cancelar.";
  }
  return null;
}

const OPERATIONAL_RESERVATION_PREFIXES = [
  "conflict:",
  "adopt_review:",
  "reappeared:",
  "modified_cancelled:",
  "modify_inhouse:",
  "conflict_update:",
  "cancel_inhouse:",
  "missing:",
];

// ─────────────────────────────────────────────────────────────────────────────

function ageDays(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / 86_400_000;
}

function minutesSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / 60_000;
}
