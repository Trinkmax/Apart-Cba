// Helpers de fecha timezone-safe. El server (Vercel) corre en UTC y la
// operación es en Argentina (UTC-3): todo cómputo de "hoy"/"mañana" o de
// límites de día DEBE pivotar sobre la timezone de la org, nunca sobre la
// del proceso. `cleaning_tasks.scheduled_for` es timestamptz → los queries
// "del día X" van por rango [00:00, 24:00) local vía dayRangeInTz, y los
// inserts arman el timestamp con zonedTimeToUtc.
//
// Funciones puras sin dependencias — importables desde server actions,
// route handlers y componentes client.

export const DEFAULT_ORG_TIMEZONE = "America/Argentina/Cordoba";

/** YYYY-MM-DD de `date` visto desde `timeZone` (en-CA da ISO predecible). */
export function ymdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayYmdInTz(timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  return ymdInTz(new Date(), timeZone);
}

/** Suma días a un YYYY-MM-DD como fecha de calendario (sin tz). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function tomorrowYmdInTz(timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  return addDaysYmd(todayYmdInTz(timeZone), 1);
}

function wallClockAsUtcMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/**
 * Instante UTC que corresponde a la hora de pared `time` (HH:mm o HH:mm:ss)
 * del día `ymd` en `timeZone`. Ej: ("2026-07-03", "11:00", ART) →
 * 2026-07-03T14:00:00.000Z. Converge en ≤2 iteraciones incluso con DST.
 */
export function zonedTimeToUtc(
  ymd: string,
  time: string,
  timeZone: string = DEFAULT_ORG_TIMEZONE,
): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = time.split(":").map(Number);
  const desired = Date.UTC(y, m - 1, d, hh, mm, ss);
  let utc = desired;
  for (let i = 0; i < 2; i++) {
    utc += desired - wallClockAsUtcMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

/**
 * Rango [inicio, fin) en ISO-UTC del día local `ymd` en `timeZone`, para
 * filtrar columnas timestamptz por "día": .gte(startIso).lt(endIso).
 */
export function dayRangeInTz(
  ymd: string,
  timeZone: string = DEFAULT_ORG_TIMEZONE,
): { startIso: string; endIso: string } {
  return {
    startIso: zonedTimeToUtc(ymd, "00:00", timeZone).toISOString(),
    endIso: zonedTimeToUtc(addDaysYmd(ymd, 1), "00:00", timeZone).toISOString(),
  };
}
