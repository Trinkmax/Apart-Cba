/**
 * Formatos de la reserva para el huésped (checkout, seguimiento, "Mis
 * reservas"). Puros y deterministas: las fechas de estadía salen de ISO
 * YYYY-MM-DD sin pasar por la zona del visitante, y los vencimientos se
 * muestran SIEMPRE en hora de Córdoba — así el server y el navegador escriben
 * lo mismo (sin saltos al hidratar) y un huésped de otro huso ve la hora del
 * equipo, que es la que cuenta.
 */

export const APART_TIME_ZONE = "America/Argentina/Cordoba";

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

interface DayParts {
  y: number;
  m: number; // 1–12
  d: number;
  wd: number; // 0 = domingo
}

function isoParts(iso: string): DayParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { y, m: mo, d, wd };
}

/** "vie 3 oct". */
export function shortDay(iso: string): string {
  const p = isoParts(iso);
  if (!p) return iso;
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "viernes 3 de octubre". */
export function longDay(iso: string): string {
  const p = isoParts(iso);
  if (!p) return iso;
  return `${WEEKDAYS_LONG[p.wd]} ${p.d} de ${MONTHS_LONG[p.m - 1]}`;
}

/** "vie 3 oct → dom 5 oct". */
export function stayRangeShort(checkIn: string, checkOut: string): string {
  return `${shortDay(checkIn)} → ${shortDay(checkOut)}`;
}

/**
 * "3 al 6 de octubre", "30 de septiembre al 2 de octubre",
 * "28 de diciembre de 2026 al 2 de enero de 2027".
 */
export function stayRangeLong(checkIn: string, checkOut: string): string {
  const a = isoParts(checkIn);
  const b = isoParts(checkOut);
  if (!a || !b) return `${checkIn} al ${checkOut}`;
  if (a.y !== b.y) {
    return `${a.d} de ${MONTHS_LONG[a.m - 1]} de ${a.y} al ${b.d} de ${MONTHS_LONG[b.m - 1]} de ${b.y}`;
  }
  if (a.m !== b.m) return `${a.d} de ${MONTHS_LONG[a.m - 1]} al ${b.d} de ${MONTHS_LONG[b.m - 1]}`;
  return `${a.d} al ${b.d} de ${MONTHS_LONG[a.m - 1]}`;
}

export function nightsLabel(n: number): string {
  return n === 1 ? "1 noche" : `${n} noches`;
}

export function guestsLabel(n: number): string {
  return n === 1 ? "1 huésped" : `${n} huéspedes`;
}

interface ZonedParts extends DayParts {
  hh: number;
  mm: number;
}

const zonedFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APART_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function zonedParts(isoInstant: string): ZonedParts | null {
  const ms = Date.parse(isoInstant);
  if (!Number.isFinite(ms)) return null;
  const parts = zonedFormatter.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hh = get("hour") % 24;
  const mm = get("minute");
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd, hh, mm };
}

/** "14:30 h", "9 h" (hora de Córdoba). */
function clockLabel(p: Pick<ZonedParts, "hh" | "mm">): string {
  return p.mm === 0 ? `${p.hh} h` : `${p.hh}:${String(p.mm).padStart(2, "0")} h`;
}

interface DeadlineParts {
  /** "hoy" / "mañana" si corresponde (respecto de `now`, en Córdoba). */
  rel: "hoy" | "mañana" | null;
  /** "lun 5 oct". */
  day: string;
  /** "9:05 h". */
  clock: string;
}

function deadlineParts(isoInstant: string, now: Date): DeadlineParts | null {
  const p = zonedParts(isoInstant);
  if (!p) return null;
  const today = zonedParts(now.toISOString());
  let rel: DeadlineParts["rel"] = null;
  if (today) {
    const dayMs = (x: DayParts) => Date.UTC(x.y, x.m - 1, x.d);
    const diffDays = Math.round((dayMs(p) - dayMs(today)) / 86_400_000);
    if (diffDays === 0) rel = "hoy";
    else if (diffDays === 1) rel = "mañana";
  }
  return { rel, day: `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]}`, clock: clockLabel(p) };
}

/**
 * Un vencimiento en palabras, en hora de Córdoba: "jue 2 oct a las 14:30 h".
 * Si vence hoy o mañana (respecto de `now`), lo dice así: "hoy a las 18 h".
 */
export function deadlineLabel(isoInstant: string, now: Date = new Date()): string {
  const d = deadlineParts(isoInstant, now);
  if (!d) return "";
  return `${d.rel ?? d.day} a las ${d.clock}`;
}

/** "hoy antes de las 18 h", "antes del lun 5 oct a las 9 h". */
export function beforePhrase(isoInstant: string, now: Date = new Date()): string {
  const d = deadlineParts(isoInstant, now);
  if (!d) return "";
  return d.rel ? `${d.rel} antes de las ${d.clock}` : `antes del ${d.day} a las ${d.clock}`;
}

/** "hoy a las 18 h", "el lun 5 oct a las 9 h". */
export function atPhrase(isoInstant: string, now: Date = new Date()): string {
  const d = deadlineParts(isoInstant, now);
  if (!d) return "";
  return d.rel ? `${d.rel} a las ${d.clock}` : `el ${d.day} a las ${d.clock}`;
}

/** Fecha de un evento pasado (pedido enviado, aviso de pago): "3 oct, 14:30 h". */
export function eventLabel(isoInstant: string): string {
  const p = zonedParts(isoInstant);
  if (!p) return "";
  return `${p.d} ${MONTHS[p.m - 1]}, ${clockLabel(p)}`;
}

/**
 * Cuánto falta, en palabras: "faltan 5 horas", "falta 1 hora", "faltan 40
 * minutos", "faltan 2 días". null si ya pasó.
 */
export function remainingLabel(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return minutes === 1 ? "falta 1 minuto" : `faltan ${minutes} minutos`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? "falta 1 hora" : `faltan ${hours} horas`;
  const days = Math.floor(hours / 24);
  return `faltan ${days} días`;
}

/** "1,2 MB", "350 KB" para mostrar el peso de un comprobante. */
export function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

/** Monto para prellenar un input de texto: 70000 → "70.000" (sin símbolo). */
export function amountInputValue(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "";
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Monto sin símbolo ni decimales, para copiar al home banking: 70000 → "70000". */
export function amountCopyValue(amount: number): string {
  return String(Math.round(amount));
}
