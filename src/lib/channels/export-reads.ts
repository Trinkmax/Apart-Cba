/**
 * Qué leyó cada OTA de nuestro calendario, y qué le falta leer.
 *
 * Con iCal no hay forma de EMPUJAR un cambio: Airbnb y Booking vienen solas a
 * leer el calendario de cada departamento, cuando quieren. Medido en producción
 * (17 a 19/11/2026, SAL648 de Apart CBA): Airbnb cada 3 horas, Booking cada 2.
 * Entre lectura y lectura la OTA sigue mostrando lo que vio la vez anterior.
 *
 * El 19/11/2026 cargaron un cierre del 22 al 24/11 en SAL648 a las 11:15.
 * Airbnb había leído a las 08:52 y volvió a las 11:52: durante 37 minutos lo
 * mostró disponible. La persona entró a Canales de venta y decía «Conectada»,
 * con «la OTA lo consultó hace 20 min» — que era la lectura de BOOKING: la
 * dirección vieja del calendario es por departamento, así que cualquier lectura
 * le sellaba la hora a las dos conexiones. Nada en la pantalla decía lo único
 * que importaba: Airbnb todavía no vio este cambio, lo va a ver a las 11:52.
 *
 * Esto es la parte pura: quién leyó, cada cuánto lee y qué cambió desde la
 * última vez. Lo que escribe en la base está en export-read-log.ts.
 */
import type { Channel } from "./types";

export type ExportReader = Channel | "unknown";
/** Por cuál de las dos direcciones entró la lectura. */
export type ExportVia = "link" | "unit";
/** Una estadía que el calendario bloquea: `[entrada, salida)`, YYYY-MM-DD. */
export type Stay = [string, string];

/** Quién lee, por cómo se presenta. Lo que no se reconoce queda `unknown`. */
export function readerFromUserAgent(userAgent: string | null | undefined): ExportReader {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("airbnb")) return "airbnb";
  if (ua.includes("booking")) return "booking";
  return "unknown";
}

/** Una conexión que leyó por su propia dirección hace menos de esto no usa la vieja. */
export const OWN_URL_FRESH_MS = 48 * 60 * 60_000;

export interface AttributableLink {
  id: string;
  channel: Channel;
  status: string;
  export_via: ExportVia | null;
  last_export_access_at: string | null;
}

/**
 * A qué conexiones del departamento se les anota una lectura de la dirección
 * vieja (`/api/ical/<unidad>`, la misma para todas).
 *
 *  1. Si quien lee se identifica, a las de ese canal.
 *  2. Si no, a las que NO están leyendo por su dirección propia: una conexión
 *     que lee por la suya no es la que está leyendo la vieja.
 *  3. Si eso no deja ninguna, a todas (no se puede saber).
 */
export function attributeUnitRead(
  links: AttributableLink[],
  reader: ExportReader,
  now: number = Date.now(),
): string[] {
  const live = links.filter((l) => l.status !== "draft");
  if (reader !== "unknown") {
    const same = live.filter((l) => l.channel === reader);
    if (same.length > 0) return same.map((l) => l.id);
  }
  const usesOwnUrl = (l: AttributableLink) =>
    l.export_via === "link" &&
    !!l.last_export_access_at &&
    now - Date.parse(l.last_export_access_at) < OWN_URL_FRESH_MS;
  const rest = live.filter((l) => !usesOwnUrl(l));
  return (rest.length > 0 ? rest : live).map((l) => l.id);
}

/** Lo que el calendario bloquea de hoy en adelante, sin repetidos y en orden. */
export function futureStays(stays: Stay[], today: string): Stay[] {
  const seen = new Set<string>();
  const out: Stay[] = [];
  for (const [from, to] of stays) {
    if (!from || !to || to <= today) continue;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([from, to]);
  }
  return out.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
}

export interface PendingChanges {
  /** Noches ocupadas acá que la OTA todavía muestra libres: se pueden vender dos veces. */
  toBlock: Stay[];
  /** Noches que la OTA sigue cerrando y acá ya se liberaron: una venta que no entra. */
  toRelease: Stay[];
}

/**
 * Qué cambió entre lo que se le sirvió a la OTA la última vez y lo que hay hoy.
 * Se comparan NOCHES, no estadías: acortar una reserva o partirla en dos no es
 * un cambio si las noches son las mismas. Sin lectura registrada (`served`
 * null) no se sabe: no se inventa nada pendiente.
 */
export function pendingChanges(current: Stay[], served: Stay[] | null, today: string): PendingChanges {
  if (served === null) return { toBlock: [], toRelease: [] };
  const now = nightsOf(futureStays(current, today), today);
  const then = nightsOf(futureStays(served, today), today);
  return {
    toBlock: rangesOf([...now].filter((n) => !then.has(n))),
    toRelease: rangesOf([...then].filter((n) => !now.has(n))),
  };
}

/** Tope de noches por estadía al comparar (una mensual de un año no cuelga nada). */
const MAX_NIGHTS = 800;

function nightsOf(stays: Stay[], today: string): Set<string> {
  const nights = new Set<string>();
  for (const [from, to] of stays) {
    let d = from < today ? today : from;
    for (let i = 0; d < to && i < MAX_NIGHTS; i++) {
      nights.add(d);
      d = addDay(d);
    }
  }
  return nights;
}

function rangesOf(nights: string[]): Stay[] {
  const sorted = [...nights].sort();
  const out: Stay[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === n) last[1] = addDay(n);
    else out.push([n, addDay(n)]);
  }
  return out;
}

function addDay(ymd: string): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

/** Dos lecturas a menos de esto son la misma (las OTAs a veces piden dos veces seguidas). */
const SAME_READ_MS = 5 * 60_000;

/**
 * Cada cuánto lee, en minutos: la mediana de los intervalos entre sus últimas
 * lecturas. `null` con menos de tres lecturas (un solo intervalo no es un ritmo).
 */
export function typicalIntervalMin(readTimes: string[]): number | null {
  const times = readTimes
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const t of times) {
    if (distinct.length === 0 || t - distinct[distinct.length - 1] >= SAME_READ_MS) distinct.push(t);
  }
  if (distinct.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i] - distinct[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(median / 60_000);
}

/** Sin una lectura en este tiempo, la OTA dejó de leer (lee cada 2-3 horas). */
export const READER_STALE_MS = 24 * 60 * 60_000;
/** Una conexión nueva que nadie leyó en este tiempo nunca se terminó de conectar. */
export const NEVER_READ_GRACE_MS = 48 * 60 * 60_000;

export type PublicationKind =
  /** La OTA nunca leyó, y la conexión es reciente: todavía puede estar por hacerlo. */
  | "waiting"
  /** Pasó el margen y nunca leyó: falta pegar el calendario en la OTA. */
  | "never"
  /** Leía y dejó de leer. */
  | "stale"
  /** Lee, y hay cambios que todavía no vio. */
  | "pending"
  /** Lee y vio todo. */
  | "ok";

export interface PublicationState {
  kind: PublicationKind;
  /** Cuándo se espera la próxima lectura (ISO), si se le conoce el ritmo. */
  nextReadAt: string | null;
  changes: PendingChanges;
}

export function publicationState(
  input: {
    lastReadAt: string | null;
    intervalMin: number | null;
    /** Desde cuándo está activa la conexión. */
    activeSince: string;
    changes: PendingChanges;
  },
  now: number = Date.now(),
): PublicationState {
  const { changes } = input;
  if (!input.lastReadAt) {
    const since = Date.parse(input.activeSince);
    const waited = Number.isNaN(since) ? Infinity : now - since;
    return { kind: waited > NEVER_READ_GRACE_MS ? "never" : "waiting", nextReadAt: null, changes };
  }
  const last = Date.parse(input.lastReadAt);
  if (!Number.isNaN(last) && now - last > READER_STALE_MS) {
    return { kind: "stale", nextReadAt: null, changes };
  }
  let nextReadAt: string | null = null;
  if (input.intervalMin && !Number.isNaN(last)) {
    const next = last + input.intervalMin * 60_000;
    // Ya debería haber leído: no se promete una hora que pasó.
    nextReadAt = next > now ? new Date(next).toISOString() : null;
  }
  const dirty = changes.toBlock.length > 0 || changes.toRelease.length > 0;
  return { kind: dirty ? "pending" : "ok", nextReadAt, changes };
}

/** «cada 3 h», «cada 2 h», «cada 45 min». */
export function intervalLabel(intervalMin: number | null): string | null {
  if (!intervalMin || intervalMin <= 0) return null;
  if (intervalMin < 90) return `cada ${Math.max(5, Math.round(intervalMin / 5) * 5)} min`;
  const hours = Math.round(intervalMin / 30) / 2;
  return `cada ${String(hours).replace(".", ",")} h`;
}

/** «22/11 → 24/11». */
export function stayLabel([from, to]: Stay): string {
  const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
  return `${dm(from)} → ${dm(to)}`;
}
