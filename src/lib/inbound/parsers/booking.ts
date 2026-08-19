import type { InboundEmailParser, ResendInboundEmail, ParsedEvent } from "../types";
import { htmlToText, normalizeDate, parseAmount } from "../parse-utils";

// Formatos de fecha aceptados: ISO, "May 15, 2026", "15 de mayo de 2026", "15 mayo 2026".
const DATE =
  "(\\d{4}-\\d{2}-\\d{2}|[A-Za-zÀ-ÿ]+\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\s+(?:de\\s+)?[A-Za-zÀ-ÿ]+\\s+(?:de\\s+)?\\d{4})";

/**
 * Parser para emails de confirmación y cancelación de Booking.com.
 * Corre sobre el texto plano del email (HTML convertido).
 */
export const bookingParser: InboundEmailParser = {
  name: "booking",

  canParse(from: string, subject: string): boolean {
    return /@booking\.com/i.test(from) || /booking\.com/i.test(subject);
  },

  parse(email: ResendInboundEmail): ParsedEvent | null {
    const subject = email.subject ?? "";
    const body = htmlToText(email.html) || email.text || "";

    // Booking pone "(número, día, fecha de llegada)" en el subject de sus dos
    // avisos de partner. Es poca información, pero es la ÚNICA que cruza la
    // identidad del email (número de reserva) con la del iCal (fecha), así que
    // se extrae siempre y se usa como fallback en las dos ramas.
    const fromSubject = subjectRef(subject);

    // Cancelación — "¡Reserva cancelada! (6017858947, martes, 21 de julio de 2026)"
    if (/cancel(led|lation|ada|aci[oó]n)/i.test(subject)) {
      const id = reservationNumber(body) ?? fromSubject?.code;
      if (!id) return null;
      return {
        type: "cancellation",
        source: "booking",
        externalId: id,
        checkIn: matchDate(body, "check.?in|llegada|arrival|entrada") ?? fromSubject?.checkIn,
      };
    }

    // Reserva nueva
    if (!/new booking|confirmation|nueva reserva|reserva confirmada/i.test(subject)) return null;

    const externalId = reservationNumber(body) ?? fromSubject?.code;
    if (!externalId) return null;

    const checkIn = matchDate(body, "check.?in|llegada|arrival|entrada");
    const checkOut = matchDate(body, "check.?out|salida|departure");
    // El aviso "¡Nueva reserva!" del extranet no trae el detalle de la estadía:
    // sin check-out no se puede proyectar una reserva. Pero número + llegada
    // alcanzan para ponerle número a la que ya entró (o va a entrar) por iCal,
    // y de ahí en más la cancelación la encuentra por referencia exacta.
    if (!checkIn || !checkOut) {
      const arrival = checkIn ?? fromSubject?.checkIn;
      return arrival
        ? { type: "reference", source: "booking", externalId, checkIn: arrival }
        : null;
    }

    const guestName =
      body
        .match(
          /(?:guest name|nombre del hu[ée]sped|booked by|hu[ée]sped)[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\s]{1,48}?)(?:\n|[·|]|$)/i,
        )?.[1]
        ?.trim() || "Huésped Booking";

    const guestEmail = body
      .match(/(?:e-?mail|correo)[:\s]+([^\s<]+@[^\s<>]+\.[a-z]{2,})/i)?.[1]
      ?.toLowerCase();
    const guestPhone = body
      .match(/(?:phone|tel[ée]fono|tel)[:\s]+([\d+][\d\s()-]{6,})/i)?.[1]
      ?.trim();

    const amount = body.match(
      /(?:total|price|precio|importe)[:\s]*(?:ARS|USD|EUR|\$)?\s*([\d.,]+)/i,
    )?.[1];
    const currency = body.match(/\b(ARS|USD|EUR)\b/)?.[1];
    const listingHint = body
      .match(/(?:property|propiedad|accommodation|alojamiento)[:\s]+([^\n·|]{2,80})/i)?.[1]
      ?.trim();
    // Listing ID determinístico — slug del hotel en la URL booking.com/hotel/<cc>/<slug>.
    const externalListingId = body.match(
      /booking\.com\/hotel\/[a-z]{2}\/([a-z0-9-]+)\.[a-z-]+\.html/i,
    )?.[1];

    return {
      type: "new_booking",
      source: "booking",
      externalId,
      checkIn,
      checkOut,
      guestName,
      guestEmail,
      guestPhone,
      totalAmount: parseAmount(amount),
      currency: currency?.toUpperCase(),
      externalListingId,
      listingHint,
    };
  },
};

/**
 * Número de reserva de Booking.com. Prioriza el match con etiqueta; el fallback
 * exige que el número largo aparezca cerca de la palabra "reserva"/"booking"
 * para no agarrar un teléfono o un precio.
 */
/**
 * Número de reserva + fecha de llegada desde el subject de Booking:
 *   "Booking.com - ¡Nueva reserva! (5718506503, viernes, 4 de diciembre de 2026)"
 *   "¡Reserva cancelada! (6017858947, martes, 21 de julio de 2026)"
 * La fecha es opcional: los subjects en inglés a veces sólo traen el número.
 */
function subjectRef(subject: string): { code: string; checkIn?: string } | null {
  const code = subject.match(/\((\d{8,14})\s*[,)]/)?.[1];
  if (!code) return null;
  // Tomamos la fecha del paréntesis, no de cualquier parte del subject.
  const inParens = subject.match(/\(\d{8,14}\s*,([^)]*)\)/)?.[1] ?? "";
  const raw = inParens.match(new RegExp(DATE))?.[1];
  return { code, checkIn: normalizeDate(raw) ?? undefined };
}

function reservationNumber(body: string): string | null {
  const labeled = body.match(
    /(?:booking number|n[uú]mero de reserva|reservation (?:id|number)|confirmation number)[:\s#]*(\d{8,14})/i,
  )?.[1];
  if (labeled) return labeled;
  const near = body.match(/(?:reserva|booking)[^\d]{0,40}(\d{9,12})/i)?.[1];
  return near ?? null;
}

function matchDate(body: string, labels: string): string | null {
  const m = body.match(new RegExp(`(?:${labels})[:\\s]+${DATE}`, "i"));
  return m ? normalizeDate(m[1]) : null;
}
