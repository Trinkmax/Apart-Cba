import ICAL from "ical.js";
import crypto from "crypto";
import { safeFetchFeed, BlockedUrlError } from "./ssrf";
import type {
  Channel,
  IcalFetchOutcome,
  NormalizedIcalEvent,
  ReservationEvent,
} from "./types";

/**
 * IcalEmailAdapter — mitad iCal. Descarga y normaliza el feed de una conexión.
 *
 * Particularidades por OTA:
 *  - Airbnb: SUMMARY "Reserved" = reserva real (la DESCRIPTION trae la URL de
 *    la reserva con el código HM… y los últimos 4 dígitos del teléfono).
 *    "Airbnb (Not available)" = bloqueo/ventana — NO se importa (rota de UID
 *    todos los días y solo genera churn; decisión de negocio previa).
 *  - Booking.com: los VEVENT no distinguen reserva de cierre manual ("CLOSED -
 *    Not available" para ambos, sin DESCRIPTION ni nada más — verificado contra
 *    los feeds de producción). Entran como RESERVA (isBlock=false) y el email de
 *    confirmación, si llega, les agrega huésped e importe.
 *
 *    Por qué reserva y no bloqueo: la ambigüedad es inevitable, así que la
 *    elección real es cuál de los dos errores preferimos. Importarlo como
 *    bloqueo hace que una reserva real quede INVISIBLE — sin notificación, sin
 *    aparecer en /dashboard/reservas, sin limpieza automática, fuera del parte
 *    diario, de los KPIs y de la liquidación al propietario, y encima no
 *    editable. Importarlo como reserva hace que un cierre manual aparezca como
 *    una reserva de $0 sin huésped: visible, listada y a un click de volver a
 *    ser un cierre ("No es una reserva" en el popover → markChannelBookingAsBlock).
 *    El error visible es siempre preferible al invisible.
 *
 *    En producción el caso frecuente es el primero: de 10 filas de Booking, 9
 *    eran reservas reales atrapadas como barras grises y CERO llegaron alguna
 *    vez por email — el "ascenso por email" nunca se dispara solo.
 *
 * Un futuro proveedor oficial (p.ej. Channex) implementaría esta misma interfaz
 * (fetch → NormalizedIcalEvent[] / ReservationEvent[]) y el resto del pipeline
 * (ingest.ts, dispatch.ts) no cambia.
 */

const AIRBNB_BLOCK = /not available|blocked|unavailable/i;
const AIRBNB_CODE_IN_DESC = /reservations\/details\/([A-Z0-9]{6,14})/i;
const AIRBNB_PHONE_IN_DESC = /phone(?:\s+number)?\s*\(last 4 digits\)\s*:\s*(\d{4})/i;

export async function fetchIcalFeed(input: {
  feedUrl: string;
  channel: Channel;
  etag?: string | null;
  lastModified?: string | null;
}): Promise<IcalFetchOutcome> {
  let res;
  try {
    res = await safeFetchFeed(input.feedUrl, {
      etag: input.etag,
      lastModified: input.lastModified,
    });
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      return { status: "blocked_url", error: err.message };
    }
    return {
      status: "http_error",
      error: err instanceof Error ? redactError(err.message) : "Error de red",
    };
  }

  if (res.status === 304) return { status: "not_modified" };
  if (res.status !== 200 || res.body === undefined) {
    return { status: "http_error", httpStatus: res.status, error: `HTTP ${res.status}` };
  }

  let events: NormalizedIcalEvent[];
  try {
    events = parseIcs(res.body, input.channel);
  } catch (err) {
    return {
      status: "parse_error",
      error: err instanceof Error ? redactError(err.message) : "ICS ilegible",
    };
  }

  // Horizonte = hasta dónde el feed publica información CONFIABLE. Se usa para
  // decidir si el silencio del feed sobre una fecha significa algo.
  //
  // No se calcula sobre el evento más lejano a secas: las OTAs publican
  // marcadores de "fuera de la ventana de disponibilidad" — bloques de medio
  // año que arrancan a 12 meses vista y a los que Booking le cambia el UID todos
  // los días. Uno solo de esos empuja el horizonte dos años para adelante y hace
  // que toda ausencia parezca concluyente, cuando no lo es. En la unidad BRASIL
  // ese marcador llevaba el horizonte a 2028-02 y ponía cada reserva del año en
  // la vía rápida.
  let horizon: string | null = null;
  const reales = events.filter((e) => nights(e.checkIn, e.checkOut) <= LONG_RANGE_BLOCK_NIGHTS);
  for (const e of reales.length > 0 ? reales : events) {
    if (!horizon || e.checkOut > horizon) horizon = e.checkOut;
  }

  return {
    status: "ok",
    events,
    horizon,
    etag: res.etag ?? null,
    lastModified: res.lastModified ?? null,
  };
}

/** Nunca dejamos pasar la URL (con token) a mensajes de error visibles. */
function redactError(msg: string): string {
  return msg.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 300);
}

export function parseIcs(icsText: string, channel: Channel): NormalizedIcalEvent[] {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");
  const out: NormalizedIcalEvent[] = [];

  for (const ve of vevents) {
    const event = new ICAL.Event(ve);
    const uid = event.uid;
    if (!uid) continue;
    // Self-import guard: nuestros propios exports usan UID apartcba-…
    if (uid.includes("apartcba")) continue;

    let checkIn: string;
    let checkOut: string;
    try {
      checkIn = toYmd(event.startDate);
      checkOut = toYmd(event.endDate);
    } catch {
      continue;
    }
    if (!checkIn || !checkOut || checkOut <= checkIn) continue;

    const summary = event.summary ?? "";
    const description = (ve.getFirstPropertyValue("description") as string | null) ?? "";

    if (channel === "airbnb") {
      if (AIRBNB_BLOCK.test(summary)) {
        // Bloqueo de disponibilidad de Airbnb: ruido de ventana/corte — no entra.
        continue;
      }
      const code = description.match(AIRBNB_CODE_IN_DESC)?.[1]?.toUpperCase();
      const phoneLast4 = description.match(AIRBNB_PHONE_IN_DESC)?.[1];
      out.push({
        uid,
        checkIn,
        checkOut,
        summary,
        isBlock: false,
        confirmationCode: code,
        phoneLast4,
      });
    } else {
      // Booking.com: todo VEVENT ocupa calendario y entra como RESERVA, sin
      // datos del huésped todavía (los trae el email de confirmación, si llega).
      // Ver la nota de arriba sobre por qué acá no se puede adivinar más.
      out.push({ uid, checkIn, checkOut, summary, isBlock: false });
    }
  }
  return out;
}

/**
 * Un VEVENT más largo que esto no es una estadía: es un marcador de ventana de
 * disponibilidad de la OTA. Sigue entrando al calendario (ocupa fechas), pero no
 * define hasta dónde el feed publica información confiable.
 */
const LONG_RANGE_BLOCK_NIGHTS = 120;

function nights(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function toYmd(t: ICAL.Time): string {
  // Eventos de OTA son VALUE=DATE (all-day). toString() de una fecha pura da
  // YYYY-MM-DD; para date-time cortamos la parte de fecha SIN convertir de
  // timezone (los feeds usan fechas de calendario, no instantes).
  const s = t.toString();
  return s.slice(0, 10);
}

/** Convierte un evento iCal normalizado en el ReservationEvent canónico. */
export function toReservationEvent(input: {
  event: NormalizedIcalEvent;
  organizationId: string;
  linkId: string;
  unitId: string;
  channel: Channel;
}): ReservationEvent {
  const { event } = input;
  const contentFingerprint = crypto
    .createHash("sha256")
    .update(`${event.uid}|${event.checkIn}|${event.checkOut}|${event.confirmationCode ?? ""}`)
    .digest("hex");
  return {
    transport: "ical",
    channel: input.channel,
    eventType: "reservation_upsert",
    organizationId: input.organizationId,
    linkId: input.linkId,
    unitId: input.unitId,
    icalUid: event.uid,
    confirmationCode: event.confirmationCode,
    checkIn: event.checkIn,
    checkOut: event.checkOut,
    isBlock: event.isBlock,
    guest: event.phoneLast4 ? { phone: undefined } : undefined,
    dedupeKey: `ical:${input.linkId}:${event.uid}:${contentFingerprint.slice(0, 16)}`,
    contentHash: contentFingerprint,
  };
}
