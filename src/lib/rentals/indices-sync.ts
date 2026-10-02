import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addDaysYmd, todayYmdInTz } from "@/lib/dates";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";

import type { IndexCode, IndexPoint } from "./indices";
import { addMonthsToMonth, compareYmd, isYmd, maxYmd, monthOf } from "./ymd";

/**
 * Sincronización automática de los índices de actualización
 * (`economic_indices`, tabla global: los índices son datos públicos e iguales
 * para todas las organizaciones). Se guardan NIVELES — ver `indices.ts`.
 *
 * Fuentes (verificadas el 2026-10-02):
 * - IPC nivel general nacional (base dic-2016 = 100): API de series de
 *   datos.gob.ar. Si falla, viene vacía o quedó atrás del calendario del
 *   INDEC, el CSV del propio INDEC (da exactamente los mismos niveles).
 * - RIPTE: API de series de datos.gob.ar.
 * - ICL, CER y UVA: API de Estadísticas del BCRA v4.0 (la v3.0 responde 410
 *   y la v2 404). Sin API key.
 * - Casa Propia: no hay fuente legible por máquina (la página oficial da
 *   403) → se carga a mano y acá no se toca.
 *
 * Reglas:
 * - Una fuente caída nunca frena a las otras: un try/catch por índice, y
 *   `syncEconomicIndices` no lanza nunca — el error vuelve en el resultado.
 * - Los parsers son puros (sin red): se testean con respuestas reales.
 * - Timeout por request con `AbortController` (no `AbortSignal.timeout`, ver
 *   `fetch-with-timeout.ts`): una fuente que no contesta no cuelga el cron.
 */

/** Valores válidos de `economic_indices.source`. */
export type IndexSource = "indec" | "bcra" | "datos_gob" | "argentinadatos" | "manual";

/** Punto con la fuente de la que salió (cada fila guarda la suya). */
export type SourcedIndexPoint = IndexPoint & { source: IndexSource };

export interface IndexSyncResult {
  code: IndexCode;
  /** Puntos válidos que devolvió la fuente. */
  fetched: number;
  /** Filas escritas (alta o actualización) en `economic_indices`. */
  upserted: number;
  /**
   * Último período guardado después de la sync. Si la fuente falló, el que ya
   * estaba (o null si la serie sigue vacía).
   */
  latest: string | null;
  /**
   * Fuente de esta corrida: un valor de `economic_indices.source`, o
   * "datos_gob+indec" si el IPC combinó las dos. null si no se llegó a leer.
   */
  source: string | null;
  error?: string;
}

export interface SyncEconomicIndicesOptions {
  /** Pide las series diarias completas desde su inicio útil, aunque ya haya datos. */
  backfill?: boolean;
  /** Hoy (`YYYY-MM-DD`, Argentina). Para tests; por defecto, el día real. */
  today?: string;
}

/** Índices que se sincronizan solos (Casa Propia se carga a mano). */
export const SYNCED_INDEX_CODES = ["ipc", "ripte", "icl", "cer", "uva"] as const satisfies readonly IndexCode[];

export type SyncedIndexCode = (typeof SYNCED_INDEX_CODES)[number];
export type DailyIndexCode = Extract<SyncedIndexCode, "icl" | "cer" | "uva">;

/** Ids de serie en la API de datos.gob.ar. */
export const DATOS_GOB_SERIES_IDS = {
  ipc: "148.3_INIVELNAL_DICI_M_26",
  ripte: "158.1_REPTE_0_0_5",
} as const;

/** Ids de variable en la API de Estadísticas del BCRA. */
export const BCRA_VARIABLE_IDS: Record<DailyIndexCode, number> = { icl: 40, cer: 30, uva: 31 };

/**
 * Desde cuándo se pide cada serie diaria en una carga completa. El ICL nace
 * el 01/07/2020 (Ley 27.551) y la UVA el 31/03/2016; el CER existe desde
 * 2002, pero antes de 2016 no le sirve a ningún contrato vigente.
 */
export const DAILY_SERIES_START: Record<DailyIndexCode, string> = {
  icl: "2020-07-01",
  uva: "2016-03-31",
  cer: "2016-01-01",
};

const DATOS_GOB_API = "https://apis.datos.gob.ar/series/api/series/";
const INDEC_IPC_CSV_URL = "https://www.indec.gob.ar/ftp/cuadros/economia/serie_ipc_divisiones.csv";
const BCRA_API = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias";

const FETCH_TIMEOUT_MS = 15_000;
/** Filas por pedido a datos.gob.ar; si una serie algún día no entra, se pagina con `start`. */
const DATOS_GOB_PAGE_LIMIT = 1000;
const DATOS_GOB_MAX_PAGES = 10;
/** El BCRA acepta hasta 3000; con 1000 una carga completa del CER son 4 pedidos. */
const BCRA_PAGE_LIMIT = 1000;
/** Freno ante un `count` absurdo: 20 páginas son 55 años de datos diarios. */
const BCRA_MAX_PAGES = 20;
const UPSERT_BATCH = 500;
/** Una sync incremental vuelve a pedir 45 días: cubre feriados largos y correcciones. */
const DAILY_LOOKBACK_DAYS = 45;
/** El ICL se publica ~14 días adelantado: se pide hasta hoy + 40. */
const DAILY_LOOKAHEAD_DAYS = 40;
/** El IPC del mes M sale a mediados de M+1; desde este día ya se lo espera. */
const IPC_RELEASE_DAY = 10;

// Un controller y un timer por llamada (lo arma `fetchWithTimeout`).
const timedFetch = fetchWithTimeout(FETCH_TIMEOUT_MS);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Número finito y positivo (un nivel nunca es 0 ni negativo), o null. */
function positiveNumber(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)
        ? Number(v)
        : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Ascendente y un punto por fecha (si una fecha se repite, gana la última). */
function normalizePoints(points: IndexPoint[]): IndexPoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, p.value);
  return [...byDate.entries()]
    .sort(([a], [b]) => compareYmd(a, b))
    .map(([date, value]) => ({ date, value }));
}

/** Serie mensual con la clave canónica `YYYY-MM-01`. */
function toMonthStarts(points: IndexPoint[]): IndexPoint[] {
  return normalizePoints(points.map((p) => ({ date: monthOf(p.date), value: p.value })));
}

function withSource(points: IndexPoint[], source: IndexSource): SourcedIndexPoint[] {
  return points.map((p) => ({ date: p.date, value: p.value, source }));
}

/** "bcra", "datos_gob", o "datos_gob+indec" cuando se combinaron fuentes. */
function sourceLabel(points: SourcedIndexPoint[]): string {
  return [...new Set(points.map((p) => p.source))].sort().join("+");
}

/** Sin tildes y en minúscula, para comparar encabezados y nombres de región. */
function foldText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* -------------------------------------------------------------------------- */
/* Parsers (puros, sin red)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Respuesta de la API de series de datos.gob.ar:
 * `{ data: [["2026-08-01", 12276.766], ...], count, meta, params }`.
 * Lee la PRIMERA serie pedida (columna 1); los `null` (mes sin dato, o fuera
 * de rango cuando se piden varias series juntas) se saltean.
 * Lanza si la respuesta trae `errors` o no tiene la forma esperada.
 */
export function parseDatosGobSeries(json: unknown): IndexPoint[] {
  if (!isRecord(json)) throw new Error("datos.gob.ar: respuesta con formato inesperado");
  const apiError = datosGobErrorMessage(json);
  if (apiError) throw new Error(`datos.gob.ar: ${apiError}`);
  if (!Array.isArray(json.data)) throw new Error("datos.gob.ar: la respuesta no trae `data`");

  const points: IndexPoint[] = [];
  for (const row of json.data as unknown[]) {
    if (!Array.isArray(row)) continue;
    const date: unknown = row[0];
    const value = positiveNumber(row[1]);
    if (isYmd(date) && value !== null) points.push({ date, value });
  }
  return normalizePoints(points);
}

/**
 * Una página de la API de Estadísticas del BCRA v4.0:
 * `{ status: 200, metadata: { resultset: { count, offset, limit } },
 *    results: [{ idVariable, detalle: [{ fecha, valor }, ...] }] }`.
 * El BCRA ordena DESCENDENTE; acá sale ascendente. `count` es el total de
 * filas del rango pedido (para paginar con `offset`).
 * Lanza si trae `errorMessages` o un `status` distinto de 200.
 */
export function parseBcraDetalle(json: unknown): { points: IndexPoint[]; count: number } {
  if (!isRecord(json)) throw new Error("BCRA: respuesta con formato inesperado");
  const apiError = bcraErrorMessage(json);
  if (apiError) throw new Error(`BCRA: ${apiError}`);
  if (!Array.isArray(json.results)) throw new Error("BCRA: la respuesta no trae `results`");

  const points: IndexPoint[] = [];
  let rows = 0;
  for (const result of json.results as unknown[]) {
    if (!isRecord(result)) continue;
    // La v4.0 anida las filas en `detalle`; la v3.0 traía fecha/valor sueltos.
    const items: unknown[] = Array.isArray(result.detalle) ? result.detalle : [result];
    for (const item of items) {
      if (!isRecord(item) || typeof item.fecha !== "string") continue;
      rows++;
      const date = item.fecha.slice(0, 10);
      const value = positiveNumber(item.valor);
      if (isYmd(date) && value !== null) points.push({ date, value });
    }
  }

  const resultset = isRecord(json.metadata) ? json.metadata.resultset : undefined;
  const declared = isRecord(resultset) ? resultset.count : undefined;
  const count =
    typeof declared === "number" && Number.isInteger(declared) && declared >= 0 ? declared : rows;
  return { points: normalizePoints(points), count };
}

/**
 * CSV del INDEC `serie_ipc_divisiones.csv` (ISO-8859-1, CRLF, separador `;`,
 * coma decimal, "NA" donde no hay dato). Encabezado:
 * `Codigo;Descripcion;Clasificador;Periodo;Indice_IPC;v_m_IPC;v_i_a_IPC;Region`.
 * Se queda con el nivel general (`Codigo` 0) de la región Nacional;
 * `Periodo` viene como `YYYYMM`. Recibe el texto YA decodificado.
 * Lanza si falta alguna de las columnas que usa.
 */
export function parseIndecIpcCsv(text: string): IndexPoint[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map(foldText);
  const col = {
    codigo: header.indexOf("codigo"),
    periodo: header.indexOf("periodo"),
    indice: header.indexOf("indice_ipc"),
    region: header.indexOf("region"),
  };
  const missing = Object.entries(col)
    .filter(([, i]) => i < 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`INDEC: al CSV le faltan columnas (${missing.join(", ")})`);
  }

  const points: IndexPoint[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    if (!/^0+$/.test(cells[col.codigo] ?? "")) continue;
    if (foldText(cells[col.region] ?? "") !== "nacional") continue;
    const date = periodoToMonth(cells[col.periodo] ?? "");
    const value = parseDecimalComma(cells[col.indice] ?? "");
    if (date && value !== null) points.push({ date, value });
  }
  return normalizePoints(points);
}

/**
 * Último mes de IPC que el INDEC ya debería haber publicado a `today`. El
 * dato del mes M sale a mediados de M+1: desde el día 10 se espera M-1;
 * antes, M-2. Sirve para notar que datos.gob.ar quedó atrasado.
 */
export function expectedIpcPeriod(today: string): string {
  const day = Number(today.slice(8, 10));
  return addMonthsToMonth(today, day >= IPC_RELEASE_DAY ? -1 : -2);
}

function datosGobErrorMessage(json: Record<string, unknown>): string | null {
  if (!Array.isArray(json.errors) || json.errors.length === 0) return null;
  return (json.errors as unknown[])
    .map((e) => (isRecord(e) && typeof e.error === "string" ? e.error : JSON.stringify(e)))
    .join("; ");
}

function bcraErrorMessage(json: Record<string, unknown>): string | null {
  const messages = Array.isArray(json.errorMessages)
    ? (json.errorMessages as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  if (messages.length > 0) return messages.join("; ");
  if (typeof json.status === "number" && json.status !== 200) return `status ${json.status}`;
  return null;
}

/** Celdas de una línea `;` sin comillas envolventes (el INDEC no las usa, pero por las dudas). */
function splitCsvLine(line: string): string[] {
  return line.split(";").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
}

/** `YYYYMM` (o `YYYY-MM`) → `YYYY-MM-01`; null si no es un mes válido. */
function periodoToMonth(raw: string): string | null {
  const m = /^(\d{4})-?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-01`;
  return isYmd(ymd) ? ymd : null;
}

/** "12276,766" → 12276.766. "NA", vacío o basura → null. */
function parseDecimalComma(raw: string): number | null {
  const s = raw.trim();
  if (!s || s.toUpperCase() === "NA") return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return positiveNumber(Number(normalized));
}

/* -------------------------------------------------------------------------- */
/* Fetchers (red, con timeout de 15 s por pedido)                              */
/* -------------------------------------------------------------------------- */

/** "sin respuesta en 15 s" en vez del críptico "This operation was aborted". */
function describeFetchFailure(e: unknown): string {
  if (isRecord(e) || e instanceof Error) {
    const err = e as { name?: unknown; message?: unknown; cause?: unknown };
    if (err.name === "AbortError") return `sin respuesta en ${FETCH_TIMEOUT_MS / 1000} s`;
    const message = typeof err.message === "string" ? err.message : String(e);
    const cause = err.cause instanceof Error ? err.cause.message : "";
    return cause && cause !== message ? `${message} (${cause})` : message;
  }
  return String(e);
}

/** GET con timeout; cualquier falla de red sale como Error con el nombre de la fuente. */
async function request(url: string, label: string, accept: string): Promise<Response> {
  try {
    return await timedFetch(url, { headers: { accept }, cache: "no-store" });
  } catch (e) {
    throw new Error(`${label}: ${describeFetchFailure(e)}`);
  }
}

/** Lee el cuerpo dentro del mismo timeout (un cuerpo estancado también corta). */
async function readBody<T>(read: () => Promise<T>, label: string): Promise<T> {
  try {
    return await read();
  } catch (e) {
    throw new Error(`${label}: ${describeFetchFailure(e)}`);
  }
}

async function getJson(url: string, label: string): Promise<unknown> {
  const res = await request(url, label, "application/json");
  const text = await readBody(() => res.text(), label);
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // se informa abajo, con el status
  }
  if (!res.ok) {
    const detail = isRecord(json) ? (bcraErrorMessage(json) ?? datosGobErrorMessage(json)) : null;
    throw new Error(`${label} respondió ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (json === undefined) throw new Error(`${label}: la respuesta no es JSON`);
  return json;
}

/** Serie completa de datos.gob.ar (pagina con `start` si algún día pasa de 1000 filas). */
async function fetchDatosGobSeries(seriesId: string): Promise<IndexPoint[]> {
  const all: IndexPoint[] = [];
  for (let page = 0; page < DATOS_GOB_MAX_PAGES; page++) {
    const start = page * DATOS_GOB_PAGE_LIMIT;
    const url =
      `${DATOS_GOB_API}?ids=${encodeURIComponent(seriesId)}` +
      `&limit=${DATOS_GOB_PAGE_LIMIT}&start=${start}&format=json`;
    const json = await getJson(url, "datos.gob.ar");
    all.push(...parseDatosGobSeries(json));
    const count = isRecord(json) && typeof json.count === "number" ? json.count : 0;
    if (start + DATOS_GOB_PAGE_LIMIT >= count) return normalizePoints(all);
  }
  throw new Error(`datos.gob.ar: la serie ${seriesId} pasa de ${DATOS_GOB_MAX_PAGES} páginas`);
}

/** CSV del INDEC, decodificado como ISO-8859-1 (como UTF-8 rompe los acentos). */
async function fetchIndecIpcCsv(): Promise<IndexPoint[]> {
  const res = await request(INDEC_IPC_CSV_URL, "INDEC", "text/csv,*/*");
  if (!res.ok) throw new Error(`INDEC respondió ${res.status}`);
  const bytes = await readBody(() => res.arrayBuffer(), "INDEC");
  return parseIndecIpcCsv(new TextDecoder("latin1").decode(bytes));
}

/**
 * Niveles del IPC nacional. Va primero a datos.gob.ar; si falla, viene vacío
 * o su último mes es anterior al que el INDEC ya debería haber publicado
 * (`expectedIpcPeriod`), suma el CSV del INDEC con `mergeIpcSources`.
 * `source` resume de dónde salió: "datos_gob", "indec" o "datos_gob+indec".
 * Lanza sólo si no consiguió ningún dato.
 */
export async function fetchIpcLevels(
  today: string = todayYmdInTz(),
): Promise<{ points: SourcedIndexPoint[]; source: string }> {
  let primary: IndexPoint[] = [];
  let primaryError = "vino vacío";
  try {
    primary = toMonthStarts(await fetchDatosGobSeries(DATOS_GOB_SERIES_IDS.ipc));
  } catch (e) {
    primaryError = errorMessage(e);
  }
  const primaryLatest = primary.at(-1)?.date ?? null;

  let fallback: IndexPoint[] = [];
  let fallbackError = "vino vacío";
  if (!primaryLatest || primaryLatest < expectedIpcPeriod(today)) {
    try {
      fallback = await fetchIndecIpcCsv();
    } catch (e) {
      fallbackError = errorMessage(e);
      if (primaryLatest) console.warn("[indices] IPC: datos.gob.ar atrasado y el CSV del INDEC falló", fallbackError);
    }
  }

  const points = mergeIpcSources(primary, fallback);
  if (points.length === 0) {
    throw new Error(`IPC sin datos — datos.gob.ar: ${primaryError} · INDEC: ${fallbackError}`);
  }
  return { points, source: sourceLabel(points) };
}

/**
 * Junta el IPC de las dos fuentes: manda datos.gob.ar y del CSV del INDEC
 * entran sólo los meses que a datos.gob.ar le faltan. Así la historia no
 * cambia según qué fuente contestó ese día, porque NO son idénticas
 * (2026-10-02: el CSV tiene abril 2019 en 213,0517, que no cierra con su
 * propia variación de 3,4 % — datos.gob.ar sí, 212,9596 — y 2024-04..11
 * redondeados a 3 decimales).
 */
export function mergeIpcSources(primary: IndexPoint[], fallback: IndexPoint[]): SourcedIndexPoint[] {
  const covered = new Set(primary.map((p) => p.date));
  return [
    ...withSource(primary, "datos_gob"),
    ...withSource(
      fallback.filter((p) => !covered.has(p.date)),
      "indec",
    ),
  ].sort((a, b) => compareYmd(a.date, b.date));
}

/** Niveles mensuales del RIPTE (datos.gob.ar). */
export async function fetchRipteLevels(): Promise<IndexPoint[]> {
  return toMonthStarts(await fetchDatosGobSeries(DATOS_GOB_SERIES_IDS.ripte));
}

/**
 * Serie diaria del BCRA entre `desde` y `hasta` (inclusive), ascendente.
 * Pagina con `offset` mientras falten filas. Ojo: el BCRA rechaza un
 * `desde` posterior a hoy (400 "La fecha desde no puede mayor a la actual").
 */
export async function fetchBcraSeries(id: number, desde: string, hasta: string): Promise<IndexPoint[]> {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`BCRA: variable inválida (${id})`);
  if (!isYmd(desde) || !isYmd(hasta)) throw new Error(`BCRA: rango inválido (${desde} → ${hasta})`);
  const all: IndexPoint[] = [];
  let offset = 0;
  for (let page = 0; page < BCRA_MAX_PAGES; page++) {
    const url =
      `${BCRA_API}/${id}?desde=${desde}&hasta=${hasta}` +
      `&limit=${BCRA_PAGE_LIMIT}&offset=${offset}`;
    const { points, count } = parseBcraDetalle(await getJson(url, "BCRA"));
    all.push(...points);
    offset += BCRA_PAGE_LIMIT;
    if (offset >= count) return normalizePoints(all);
  }
  throw new Error(`BCRA: la variable ${id} pasa de ${BCRA_MAX_PAGES} páginas`);
}

/* -------------------------------------------------------------------------- */
/* Sincronización contra `economic_indices`                                    */
/* -------------------------------------------------------------------------- */

// El cliente admin viene pinneado al schema `apartcba`; con el genérico por
// defecto ("public") no se puede pasar. Misma convención que channels/ e ical/.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

/**
 * Rango a pedirle al BCRA para una serie diaria. Incremental: desde 45 días
 * antes del último dato guardado (feriados largos, correcciones). Completo
 * (backfill o serie vacía): desde su inicio útil. Siempre hasta hoy + 40 (el
 * ICL sale adelantado) y con `desde` ≤ hoy, porque el BCRA rechaza un
 * `desde` futuro.
 */
export function dailyFetchRange(
  code: DailyIndexCode,
  latestStored: string | null,
  today: string,
  backfill = false,
): { desde: string; hasta: string } {
  const start = DAILY_SERIES_START[code];
  let desde = backfill || !latestStored ? start : addDaysYmd(latestStored, -DAILY_LOOKBACK_DAYS);
  if (desde < start) desde = start;
  if (desde > today) desde = today;
  return { desde, hasta: addDaysYmd(today, DAILY_LOOKAHEAD_DAYS) };
}

/**
 * Trae y guarda IPC, RIPTE, ICL, CER y UVA. Cada índice va por su cuenta (en
 * paralelo, con su propio try/catch): si el BCRA no contesta, el IPC se
 * guarda igual. No lanza nunca; el detalle de cada índice vuelve en el
 * resultado, en el orden de `SYNCED_INDEX_CODES`.
 */
export async function syncEconomicIndices(
  admin: AdminClient,
  opts: SyncEconomicIndicesOptions = {},
): Promise<IndexSyncResult[]> {
  const today = opts.today && isYmd(opts.today) ? opts.today : todayYmdInTz();
  const backfill = opts.backfill === true;
  return Promise.all(
    SYNCED_INDEX_CODES.map((code) =>
      syncIndex(admin, code, today, backfill).catch(
        (e: unknown): IndexSyncResult => ({
          code,
          fetched: 0,
          upserted: 0,
          latest: null,
          source: null,
          error: errorMessage(e),
        }),
      ),
    ),
  );
}

async function syncIndex(
  admin: AdminClient,
  code: SyncedIndexCode,
  today: string,
  backfill: boolean,
): Promise<IndexSyncResult> {
  const result: IndexSyncResult = { code, fetched: 0, upserted: 0, latest: null, source: null };
  try {
    const stored = await readLatestPeriod(admin, code);
    result.latest = stored;

    const { points, source } = await fetchIndex(code, stored, today, backfill);
    result.fetched = points.length;
    result.source = source;

    const saved = await upsertPoints(admin, code, points);
    result.upserted = saved.upserted;
    if (saved.lastSaved) result.latest = stored ? maxYmd(stored, saved.lastSaved) : saved.lastSaved;
    if (saved.error) result.error = saved.error;
  } catch (e) {
    result.error = errorMessage(e);
  }
  if (result.error) console.warn(`[indices] ${code}: ${result.error}`);
  return result;
}

async function fetchIndex(
  code: SyncedIndexCode,
  stored: string | null,
  today: string,
  backfill: boolean,
): Promise<{ points: SourcedIndexPoint[]; source: string }> {
  if (code === "ipc") return fetchIpcLevels(today);
  if (code === "ripte") {
    const points = await fetchRipteLevels();
    if (points.length === 0) throw new Error("datos.gob.ar no devolvió datos");
    return { points: withSource(points, "datos_gob"), source: "datos_gob" };
  }
  const { desde, hasta } = dailyFetchRange(code, stored, today, backfill);
  const points = await fetchBcraSeries(BCRA_VARIABLE_IDS[code], desde, hasta);
  // El rango siempre abarca algo publicado (como mínimo, lo ya guardado): vacío es una falla.
  if (points.length === 0) throw new Error(`el BCRA no devolvió datos entre ${desde} y ${hasta}`);
  return { points: withSource(points, "bcra"), source: "bcra" };
}

/** Último período guardado de un índice (o null si la serie está vacía). */
async function readLatestPeriod(admin: AdminClient, code: IndexCode): Promise<string | null> {
  const { data, error } = await admin
    .from("economic_indices")
    .select("period")
    .eq("index_code", code)
    .order("period", { ascending: false })
    .limit(1);
  if (error) throw new Error(`no se pudo leer el último dato guardado: ${error.message}`);
  const rows: unknown = data;
  const period = Array.isArray(rows) && isRecord(rows[0]) ? rows[0].period : null;
  return typeof period === "string" && isYmd(period.slice(0, 10)) ? period.slice(0, 10) : null;
}

/**
 * Upsert en lotes de 500 sobre la PK (index_code, period). Todas las filas
 * llevan las mismas claves: en un insert en lote PostgREST manda NULL (no el
 * DEFAULT) en la clave que le falte a alguna. `fetched_at` va explícito
 * porque en el UPDATE del upsert el default no se vuelve a aplicar.
 * Como los puntos vienen ascendentes, `lastSaved` es el más nuevo guardado.
 */
async function upsertPoints(
  admin: AdminClient,
  code: IndexCode,
  points: SourcedIndexPoint[],
): Promise<{ upserted: number; lastSaved: string | null; error: string | null }> {
  const fetchedAt = new Date().toISOString();
  const rows = points.map((p) => ({
    index_code: code,
    period: p.date,
    value: p.value,
    source: p.source,
    fetched_at: fetchedAt,
  }));
  let upserted = 0;
  let lastSaved: string | null = null;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await admin
      .from("economic_indices")
      .upsert(batch, { onConflict: "index_code,period" });
    if (error) return { upserted, lastSaved, error: `no se pudo guardar: ${error.message}` };
    upserted += batch.length;
    lastSaved = batch[batch.length - 1].period;
  }
  return { upserted, lastSaved, error: null };
}
