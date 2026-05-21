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

    // Cancelación
    if (/cancel(led|lation|ada|aci[oó]n)/i.test(subject)) {
      const id = reservationNumber(body);
      return id ? { type: "cancellation", source: "booking", externalId: id } : null;
    }

    // Reserva nueva
    if (!/new booking|confirmation|nueva reserva|reserva confirmada/i.test(subject)) return null;

    const externalId = reservationNumber(body);
    if (!externalId) return null;

    const checkIn = matchDate(body, "check.?in|llegada|arrival|entrada");
    const checkOut = matchDate(body, "check.?out|salida|departure");
    if (!checkIn || !checkOut) return null;

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
