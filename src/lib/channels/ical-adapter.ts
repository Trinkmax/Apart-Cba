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
 *  - Booking.com: los VEVENT no distinguen reserva de bloqueo ("CLOSED - Not
 *    available" para ambos). Todos ocupan calendario → entran con isBlock=true
 *    y un email posterior los asciende a reserva real.
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

  let horizon: string | null = null;
  for (const e of events) {
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
      // Booking.com: todo VEVENT ocupa calendario; sin datos no es una reserva
      // "real" todavía (isBlock=true hasta que el email la enriquezca).
      out.push({ uid, checkIn, checkOut, summary, isBlock: true });
    }
  }
  return out;
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
