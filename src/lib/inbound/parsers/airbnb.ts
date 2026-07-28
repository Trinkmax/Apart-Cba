import type { InboundEmailParser, ResendInboundEmail, ParsedEvent } from "../types";
import { htmlToText, normalizeDate, normalizeEsDateLoose, parseAmount } from "../parse-utils";

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

    // Reserva nueva (Reservation confirmed / Reservación confirmada / etc.)
    if (!/reserv|booking|confirm/i.test(subject)) return null;

    const externalId = confirmationCode(body);
    if (!externalId) return null;

    // Las notificaciones de host de Airbnb ("Reservación confirmada: X llega
    // el 27 jul.") traen fechas cortas SIN año: "Check-in jue, 6 ago". El año
    // se infiere (el próximo que caiga adelante); el check-out nunca puede ser
    // anterior al check-in, así que se usa como piso para el cruce de año.
    const checkIn =
      matchDateLoose(body, "check.?in|llegada|entrada") ??
      matchDate(body, "check.?in|llegada|entrada");
    const checkOut =
      matchDateLoose(body, "check.?out|salida", checkIn ?? undefined) ??
      matchDate(body, "check.?out|salida");
    if (!checkIn || !checkOut) return null;

    // Nombre completo: primero del subject ("Reservación confirmada: {Nombre}
    // llega el ..."), después las etiquetas del cuerpo.
    const guestName =
      subject.match(/confirmad[ao]:?\s+(.+?)\s+(?:llega|arrives)/i)?.[1]?.trim() ||
      body
        .match(/(?:guest|hu[ée]sped|nombre)[:\s]+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\s]{1,48}?)(?:\n|[·|]|$)/i)?.[1]
        ?.trim() ||
      "Huésped Airbnb";

    const amount =
      body.match(/(?:total|monto|payout|ganancia)[:\s]*\$?\s*([\d.,]+)/i)?.[1] ??
      // "El huésped pagó $17.39 x 29 noches $504.31" — subtotal de la estadía
      body.match(/noches\s*\$\s*([\d.,]+)/i)?.[1];
    const listingHint =
      // línea con el nombre del alojamiento, justo antes del tipo de propiedad
      body.match(/([^\n]{4,80})\n(?:Vivienda|Habitaci[oó]n|Casa|Alojamiento entero)/i)?.[1]?.trim() ??
      body.match(/(?:listing|propiedad|alojamiento)[:\s]+([^\n·|]{2,80})/i)?.[1]?.trim();
    // Listing ID determinístico — URL airbnb.com/rooms/<id> en el cuerpo.
    // Los listings modernos de Airbnb usan IDs largos (18-19 dígitos), así que no
    // acotamos el máximo: \d{4,} captura el id completo y evita truncarlo.
    const externalListingId = body.match(/airbnb\.[a-z.]+\/rooms\/(\d{4,})/i)?.[1];

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
    /(?:confirmation code|c[oó]digo de confirmaci[oó]n)[:\s]*([A-Z0-9]{6,12})\b/i,
  )?.[1];
  if (labeled) return labeled.toUpperCase();
  const hm = body.match(/\bHM[A-Z0-9]{6,10}\b/)?.[0];
  return hm ? hm.toUpperCase() : null;
}

function matchDate(body: string, labels: string): string | null {
  const m = body.match(new RegExp(`(?:${labels})[:\\s]+${DATE}`, "i"));
  return m ? normalizeDate(m[1]) : null;
}

// Fecha corta es-AR con día de semana y sin año: "jue, 6 ago", "27 jul 3:00 p.m."
const DATE_LOOSE =
  "((?:lun|mar|mi[ée]|jue|vie|s[áa]b|dom)\\.?,?\\s*)?(\\d{1,2}\\s*(?:de\\s+)?[A-Za-zÀ-ÿ]{3,12}\\.?(?:\\s*(?:de\\s+)?\\d{4})?|\\d{4}-\\d{2}-\\d{2})";

function matchDateLoose(body: string, labels: string, notBefore?: string): string | null {
  const m = body.match(new RegExp(`(?:${labels})[:\\s]*${DATE_LOOSE}`, "i"));
  return m ? normalizeEsDateLoose(m[2], { notBefore }) : null;
}
