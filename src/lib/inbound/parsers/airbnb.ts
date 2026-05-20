import type { InboundEmailParser, ResendInboundEmail, ParsedEvent } from "../types";

/**
 * Parser para emails de confirmación y cancelación de Airbnb.
 * Soporta subjects en inglés y español.
 */
export const airbnbParser: InboundEmailParser = {
  name: "airbnb",

  canParse(from: string, subject: string): boolean {
    return /@airbnb\.com/i.test(from) || /airbnb/i.test(subject);
  },

  parse(email: ResendInboundEmail): ParsedEvent | null {
    const subject = email.subject ?? "";
    const body = email.html || email.text || "";

    // Cancellation
    if (/cancel(led|lation|ada)/i.test(subject)) {
      const confMatch = body.match(/(?:confirmation code|código de confirmación)[:\s]*([A-Z0-9]{8,12})/i);
      if (confMatch) {
        return {
          type: "cancellation",
          source: "airbnb",
          externalId: confMatch[1],
        };
      }
      return null;
    }

    // New booking (Reservation Confirmed / Reserva confirmada / New reservation)
    if (!/reserv|booking|confirm/i.test(subject)) return null;

    // Confirmation code
    const confCode =
      body.match(/(?:confirmation code|código de confirmación)[:\s]*([A-Z0-9]{8,12})/i)?.[1] ??
      body.match(/(?:HM)[A-Z0-9]{6,10}/)?.[0];
    if (!confCode) return null;

    // Dates — try multiple formats
    // "Check-in: May 15, 2026" or "Llegada: 15 de mayo de 2026" or "2026-05-15"
    const checkInMatch =
      body.match(/(?:check.?in|llegada|check-in)[:\s]*(\d{4}-\d{2}-\d{2})/i) ??
      body.match(/(?:check.?in|llegada)[:\s]*(\w+ \d{1,2},?\s*\d{4})/i);
    const checkOutMatch =
      body.match(/(?:check.?out|salida|check-out)[:\s]*(\d{4}-\d{2}-\d{2})/i) ??
      body.match(/(?:check.?out|salida)[:\s]*(\w+ \d{1,2},?\s*\d{4})/i);

    const checkIn = checkInMatch ? normalizeDate(checkInMatch[1]) : null;
    const checkOut = checkOutMatch ? normalizeDate(checkOutMatch[1]) : null;
    if (!checkIn || !checkOut) return null;

    // Guest name
    const guestName =
      body.match(/(?:guest|huésped|nombre)[:\s]*([A-Za-zÀ-ÿ\s]+?)(?:<|,|\n|\r|$)/i)?.[1]?.trim() ??
      "Huésped Airbnb";

    // Amount
    const amountMatch = body.match(/(?:total|monto|payout)[:\s]*\$?([\d,.]+)/i);
    const totalAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : undefined;

    // Listing hint
    const listingHint =
      body.match(/(?:listing|propiedad|alojamiento)[:\s]*([^\n<]+)/i)?.[1]?.trim();

    return {
      type: "new_booking",
      source: "airbnb",
      externalId: confCode,
      checkIn,
      checkOut,
      guestName,
      totalAmount,
      listingHint,
    };
  },
};

function normalizeDate(raw: string): string | null {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}
