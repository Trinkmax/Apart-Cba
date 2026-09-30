/**
 * Evento de calendario (.ics) de una estadía, armado en el navegador del
 * huésped ("Agregar al calendario"). Un solo evento de día completo que va del
 * día de llegada al de salida INCLUSIVE: el día que devolvés las llaves también
 * tiene que aparecer en la agenda.
 */

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

const compactDate = (iso: string) => iso.replaceAll("-", "");

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapa texto según RFC 5545 (barra, punto y coma, coma y saltos de línea). */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Pliega una línea a 75 octetos (UTF-8) con CRLF + espacio, sin cortar caracteres. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // las continuaciones llevan un espacio adelante
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export interface StayIcsInput {
  /** Identificador estable (id de la solicitud o de la reserva). */
  uid: string;
  title: string;
  checkIn: string;
  checkOut: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  now?: Date;
}

export function buildStayIcs(p: StayIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//apart//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${p.uid}@apartcba.com`,
    `DTSTAMP:${utcStamp(p.now ?? new Date())}`,
    `DTSTART;VALUE=DATE:${compactDate(p.checkIn)}`,
    `DTEND;VALUE=DATE:${compactDate(addOneDay(p.checkOut))}`,
    `SUMMARY:${escapeIcsText(p.title)}`,
    p.location ? `LOCATION:${escapeIcsText(p.location)}` : null,
    p.description ? `DESCRIPTION:${escapeIcsText(p.description)}` : null,
    p.url ? `URL:${p.url}` : null,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => Boolean(l));
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Nombre de archivo seguro: "apart-AP-7F3K2Q.ics". */
export function icsFileName(code: string): string {
  const safe = code.replace(/[^A-Za-z0-9-]+/g, "").slice(0, 40) || "reserva";
  return `apart-${safe}.ics`;
}
