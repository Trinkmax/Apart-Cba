/**
 * Utilidades compartidas por los parsers de inbound email (Airbnb, Booking.com).
 */

/**
 * Convierte HTML a texto plano. Los emails de las OTAs llegan como HTML; correr
 * los regex de los parsers sobre el HTML crudo produce falsos positivos (matchea
 * nombres de clases CSS, colores hex, IDs de tracking). Esto deja texto legible.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Normaliza una fecha a ISO `YYYY-MM-DD`. Soporta ISO, inglés ("May 15, 2026",
 * "15 May 2026") y español ("15 de mayo de 2026", "15 mayo 2026"). Devuelve null
 * si no la puede interpretar — preferimos fallar antes que adivinar mal.
 */
export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Español: "15 de mayo de 2026" / "15 mayo 2026"
  const es = s.toLowerCase().match(/(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (es) {
    const month = SPANISH_MONTHS[es[2]];
    const day = parseInt(es[1], 10);
    if (month && day >= 1 && day <= 31) {
      return `${es[3]}-${pad(month)}-${pad(day)}`;
    }
  }

  // Inglés u otros: parsear forzando UTC para no correr el día por timezone.
  const utc = Date.parse(`${s} UTC`);
  if (!Number.isNaN(utc)) return new Date(utc).toISOString().slice(0, 10);
  const any = Date.parse(s);
  if (!Number.isNaN(any)) return new Date(any).toISOString().slice(0, 10);
  return null;
}

/**
 * Parsea un monto que puede venir en formato es-AR ("1.234,56") o en ("1,234.56").
 */
export function parseAmount(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

const ES_MONTH_PREFIX: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * Normaliza fechas es-AR "cortas" como las de los emails de host de Airbnb:
 * "jue, 6 ago", "27 jul", "6 sept", con o sin año. Si falta el año lo infiere:
 * el más cercano que no caiga antes de `notBefore` (por defecto, hoy-45 días —
 * las notificaciones de reservas nunca refieren fechas más viejas que eso).
 * También acepta los formatos completos de `normalizeDate`.
 */
export function normalizeEsDateLoose(
  raw: string | null | undefined,
  opts: { notBefore?: string } = {},
): string | null {
  if (!raw) return null;
  // Sólo delegar en normalizeDate si hay un año explícito de 4 dígitos — su
  // fallback Date.parse interpreta "27 jul 3:00 p.m." tomando la hora como
  // año ("2001-07-27") y contaminaría la inferencia.
  if (/\b\d{4}\b/.test(raw)) {
    const full = normalizeDate(raw);
    if (full) return full;
  }

  const m = raw
    .toLowerCase()
    .match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]{3,12})\.?\s*(?:de\s+)?(\d{4})?/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = ES_MONTH_PREFIX[m[2].slice(0, 3)];
  if (!month || day < 1 || day > 31) return null;
  if (m[3]) return `${m[3]}-${pad(month)}-${pad(day)}`;

  const floorDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const floor =
    opts.notBefore ??
    `${floorDate.getUTCFullYear()}-${pad(floorDate.getUTCMonth() + 1)}-${pad(floorDate.getUTCDate())}`;
  const baseYear = parseInt(floor.slice(0, 4), 10);
  for (const year of [baseYear, baseYear + 1]) {
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    if (iso >= floor) return iso;
  }
  return null;
}
