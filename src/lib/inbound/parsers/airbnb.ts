import type { InboundEmailParser, ResendInboundEmail, ParsedEvent } from "../types";
import { htmlToText, normalizeDate, parseAmount } from "../parse-utils";

// Formatos de fecha aceptados: ISO, "May 15, 2026", "15 de mayo de 2026", "15 mayo 2026".
const DATE =
  "(\\d{4}-\\d{2}-\\d{2}|[A-Za-zÀ-ÿ]+\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\s+(?:de\\s+)?[A-Za-zÀ-ÿ]+\\s+(?:de\\s+)?\\d{4})";

/**
 * Parser para emails de confirmación y cancelación de Airbnb.
 * Corre sobre el texto plano del email (HTML convertido) para evitar falsos
 * positivos contra tags/estilos. Soporta subjects en inglés y español.
 */
export const airbnbParser: InboundEmailParser = {
  name: "airbnb",

  canParse(from: string, subject: string): boolean {
    return /@airbnb\.com/i.test(from) || /airbnb/i.test(subject);
  },

  parse(email: ResendInboundEmail): ParsedEvent | null {
    const subject = email.subject ?? "";
    const body = htmlToText(email.html) || email.text || "";

    // Cancelación
    if (/cancel(led|lation|ada|aci[oó]n)/i.test(subject)) {
      const code = confirmationCode(body);
      return code ? { type: "cancellation", source: "airbnb", externalId: code } : null;
    }

    // Reserva nueva (Reservation confirmed / Reserva confirmada / etc.)
    if (!/reserv|booking|confirm/i.test(subject)) return null;

    const externalId = confirmationCode(body);
    if (!externalId) return null;

    const checkIn = matchDate(body, "check.?in|llegada|entrada");
    const checkOut = matchDate(body, "check.?out|salida");
    if (!checkIn || !checkOut) return null;

    const guestName =
      body
        .match(/(?:guest|hu[ée]sped|nombre)[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\s]{1,48}?)(?:\n|[·|]|$)/i)?.[1]
        ?.trim() || "Huésped Airbnb";

    const amount = body.match(/(?:total|monto|payout|ganancia)[:\s]*\$?\s*([\d.,]+)/i)?.[1];
    const listingHint = body
      .match(/(?:listing|propiedad|alojamiento)[:\s]+([^\n·|]{2,80})/i)?.[1]
      ?.trim();
    // Listing ID determinístico — URL airbnb.com/rooms/<id> en el cuerpo.
    const externalListingId = body.match(/airbnb\.[a-z.]+\/rooms\/(\d{4,14})/i)?.[1];

    return {
      type: "new_booking",
      source: "airbnb",
      externalId,
      checkIn,
      checkOut,
      guestName,
      totalAmount: parseAmount(amount),
      externalListingId,
      listingHint,
    };
  },
};

/**
 * Código de confirmación de Airbnb. Prioriza el match con etiqueta; el fallback
 * "HM..." está anclado al prefijo real de los códigos de Airbnb para no matchear
 * texto cualquiera.
 */
function confirmationCode(body: string): string | null {
  const labeled = body.match(
    /(?:confirmation code|c[oó]digo de confirmaci[oó]n)[:\s]+([A-Z0-9]{6,12})/i,
  )?.[1];
  if (labeled) return labeled.toUpperCase();
  const hm = body.match(/\bHM[A-Z0-9]{6,10}\b/)?.[0];
  return hm ? hm.toUpperCase() : null;
}

function matchDate(body: string, labels: string): string | null {
  const m = body.match(new RegExp(`(?:${labels})[:\\s]+${DATE}`, "i"));
  return m ? normalizeDate(m[1]) : null;
}
