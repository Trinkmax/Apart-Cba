import type { InboundEmailParser, ResendInboundEmail, ParsedEvent } from "../types";

/**
 * Parser para emails de confirmación y cancelación de Booking.com.
 */
export const bookingParser: InboundEmailParser = {
  name: "booking",

  canParse(from: string, subject: string): boolean {
    return /@booking\.com/i.test(from) || /booking\.com/i.test(subject);
  },

  parse(email: ResendInboundEmail): ParsedEvent | null {
    const subject = email.subject ?? "";
    const body = email.html || email.text || "";

    // Cancellation
    if (/cancel(led|lation|ada)/i.test(subject)) {
      const resIdMatch = body.match(/(?:reservation|booking)[\s#:]*(\d{8,12})/i);
      if (resIdMatch) {
        return {
          type: "cancellation",
          source: "booking",
          externalId: resIdMatch[1],
        };
      }
      return null;
    }

    // New booking (New Booking / Confirmation / Nueva reserva)
    if (!/new booking|confirmation|nueva reserva|reserva confirmada/i.test(subject)) return null;

    // Booking number
    const bookingNum =
      body.match(/(?:booking number|número de reserva|reservation id)[:\s#]*(\d{8,14})/i)?.[1] ??
      body.match(/\b(\d{10,14})\b/)?.[1];
    if (!bookingNum) return null;

    // Dates
    const checkInMatch =
      body.match(/(?:check.?in|llegada|arrival)[:\s]*(\d{4}-\d{2}-\d{2})/i) ??
      body.match(/(?:check.?in|llegada|arrival)[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i);
    const checkOutMatch =
      body.match(/(?:check.?out|salida|departure)[:\s]*(\d{4}-\d{2}-\d{2})/i) ??
      body.match(/(?:check.?out|salida|departure)[:\s]*(\d{1,2}\s+\w+\s+\d{4})/i);

    const checkIn = checkInMatch ? normalizeDate(checkInMatch[1]) : null;
    const checkOut = checkOutMatch ? normalizeDate(checkOutMatch[1]) : null;
    if (!checkIn || !checkOut) return null;

    // Guest name
    const guestName =
      body.match(/(?:guest name|nombre del huésped|booked by)[:\s]*([A-Za-zÀ-ÿ\s]+?)(?:<|,|\n|\r|$)/i)?.[1]?.trim() ??
      "Huésped Booking";

    // Guest email
    const guestEmail = body.match(/(?:email)[:\s]*([^\s<]+@[^\s<>]+)/i)?.[1];

    // Guest phone
    const guestPhone = body.match(/(?:phone|teléfono|tel)[:\s]*([\d+\s()-]+)/i)?.[1]?.trim();

    // Amount
    const amountMatch = body.match(/(?:total|price|precio)[:\s]*(?:ARS|USD|EUR)?\s*\$?([\d,.]+)/i);
    const totalAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : undefined;
    const currencyMatch = body.match(/(?:ARS|USD|EUR)/i);

    // Listing hint
    const listingHint =
      body.match(/(?:property|propiedad|accommodation)[:\s]*([^\n<]+)/i)?.[1]?.trim();

    return {
      type: "new_booking",
      source: "booking",
      externalId: bookingNum,
      checkIn,
      checkOut,
      guestName,
      guestEmail,
      guestPhone,
      totalAmount,
      currency: currencyMatch?.[0]?.toUpperCase(),
      listingHint,
    };
  },
};

function normalizeDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}
