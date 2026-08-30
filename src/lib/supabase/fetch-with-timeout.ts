/**
 * fetch con timeout por request para los clientes de Supabase del servidor.
 *
 * Por qué existe: el 2026-08-29 (22:00–00:00 UTC) Supabase entero se degradó
 * (REST/auth con origin_time promedio de 4-6 s y máximos de ~295 s, JWKS de
 * 36-113 s) sin devolver 5xx. Postgres estaba sano; lo que colgaba era la capa
 * HTTP de adelante. Como ningún cliente pasaba `global.fetch` con señal de
 * abort, cada función de Vercel quedó esperando hasta su maxDuration (60 s en
 * los crons, hasta 300 s en páginas/actions/proxy) → pico de GB-hrs, proxy
 * 500eando y el dashboard "colgado" en vez de fallar rápido.
 *
 * Decisiones que NO son obvias (medidas contra un servidor local que nunca
 * responde, ver veredicto del verificador):
 *
 * - NO usamos `AbortSignal.timeout()` para el timer principal: su reason es un
 *   DOMException `TimeoutError`, y postgrest-js sólo reconoce `AbortError` /
 *   `ABORT_ERR` como abort. Con TimeoutError reintenta los GET/HEAD 3 veces
 *   con sleeps de 1/2/4 s → un timeout de 300 ms terminaba tardando 8,2 s y
 *   abriendo 4 requests. Con `AbortController#abort()` sin reason (AbortError)
 *   postgrest-js devuelve `{ data: null, error, status: 0 }` en ≈T ms con un
 *   solo request; storage-js lo convierte en `StorageUnknownError` y auth-js
 *   en `AuthRetryableFetchError` (status 0) — que NO borra la sesión, así que
 *   al recuperarse Supabase el usuario entra sin reloguear.
 *
 * - El controller y el timer se crean POR LLAMADA, nunca al construir el
 *   cliente: `createAdminClient` está memoizado con React.cache, un signal
 *   compartido abortaría todas las queries del request tras el primer
 *   vencimiento.
 *
 * - En el camino feliz el timer NO se limpia al recibir los headers: cubre
 *   también la lectura del body (`res.json()` de supabase-js), que fue uno de
 *   los modos de falla del incidente (headers recibidos, body estancado).
 *   Abortar un request ya consumido es un no-op en undici, y el timer va
 *   `unref()`eado para no sostener el event loop.
 *
 * - Se compone con la señal que venga en `init.signal` (ej. `.abortSignal()`
 *   de postgrest-js) y con una señal opcional "de invocación" (ver `opts`),
 *   usando `AbortSignal.any` si existe (Node ≥ 20.3) o un fallback manual con
 *   limpieza de listeners.
 *
 * Streams / uploads: sólo agregamos `signal`, el resto del `init` (body,
 * duplex, headers) pasa intacto, así que los uploads a Storage y los bodies
 * en streaming siguen funcionando igual.
 */

export type TimeoutPicker = (url: string, init?: RequestInit) => number;

export interface FetchWithTimeoutOptions {
  /**
   * Señal a nivel invocación (un request del proxy, un tick de cron). Cuando
   * se aborta, cualquier fetch posterior falla al instante sin abrir sockets.
   * Sirve para cortar el loop de reintentos de refresh de auth-js (~25 s de
   * backoff ante errores retryable) una vez vencido un deadline externo.
   */
  signal?: AbortSignal;
}

/**
 * Devuelve un `fetch` compatible que aborta cada request a los `timeout` ms
 * (número fijo o función que elige el timeout según URL/método).
 */
export function fetchWithTimeout(
  timeout: number | TimeoutPicker,
  opts: FetchWithTimeoutOptions = {}
): typeof fetch {
  const pick: TimeoutPicker = typeof timeout === "number" ? () => timeout : timeout;

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const ms = Math.max(1, pick(requestUrl(input), init));

    // Controller propio por llamada (ver nota arriba sobre React.cache).
    const ac = new AbortController();
    const composed = composeSignals(ac.signal, init?.signal, opts.signal);

    const timer = setTimeout(() => {
      // Sin reason → DOMException AbortError, que es lo que postgrest-js
      // reconoce como abort real (no reintenta).
      ac.abort();
      composed.cleanup();
    }, ms);
    unref(timer);

    return fetch(input, { ...init, signal: composed.signal }).then(
      (res) => res,
      (err: unknown) => {
        clearTimeout(timer);
        composed.cleanup();
        throw err;
      }
    );
  };
}

/* -------------------------------------------------------------------------- */
/* Tiers de timeout para Supabase                                              */
/* -------------------------------------------------------------------------- */

export interface SupabaseTimeoutTiers {
  /** `/auth/v1/*` — token, user, JWKS interno de auth-js. Sano: 300-700 ms. */
  auth: number;
  /** `/rest/v1/*` — from()/rpc(). Sano: p50 ~230 ms, max ~1 s. */
  rest: number;
  /** Escrituras a Storage (POST/PUT/PATCH sobre object/upload). Hasta 15 MB. */
  storageWrite: number;
  /** Resto de Storage (GET de objetos, render/image, listados, borrados). */
  storage: number;
  /** Cualquier otra cosa (functions/v1, URLs desconocidas). */
  default: number;
}

/**
 * Valores por defecto para server actions, RSC y crons. Son ~10× el peor caso
 * sano medido en edge_logs, y cortan el patrón de 4-6 s del incidente.
 * Si aparece un RPC legítimamente lento, subí el tier de ESA ruta en un
 * picker propio, no el default.
 */
export const SUPABASE_TIMEOUTS: SupabaseTimeoutTiers = {
  auth: 8_000,
  rest: 10_000,
  storageWrite: 60_000,
  storage: 15_000,
  default: 10_000,
};

/**
 * Arma un picker que elige el tier según el path de la URL de Supabase.
 * Pasale overrides para contextos con presupuesto distinto (ej. el proxy).
 */
export function createSupabaseTimeoutPicker(
  overrides: Partial<SupabaseTimeoutTiers> = {}
): TimeoutPicker {
  const tiers: SupabaseTimeoutTiers = { ...SUPABASE_TIMEOUTS, ...overrides };

  return (url, init) => {
    const path = pathnameOf(url);
    if (path.startsWith("/auth/v1/")) return tiers.auth;
    if (path.startsWith("/rest/v1/")) return tiers.rest;
    if (path.startsWith("/storage/v1/")) {
      const method = (init?.method ?? "GET").toUpperCase();
      const isWrite =
        (path.startsWith("/storage/v1/object") || path.startsWith("/storage/v1/upload")) &&
        (method === "POST" || method === "PUT" || method === "PATCH");
      return isWrite ? tiers.storageWrite : tiers.storage;
    }
    return tiers.default;
  };
}

/** Picker con los tiers por defecto — compartido por los tres factories. */
export const pickSupabaseTimeout: TimeoutPicker = createSupabaseTimeoutPicker();

/* -------------------------------------------------------------------------- */
/* Deadline de invocación                                                      */
/* -------------------------------------------------------------------------- */

/** Valor que devuelve `withDeadline` cuando se venció el plazo. */
export const DEADLINE: unique symbol = Symbol("deadline");

/**
 * Espera `promise` como máximo `ms`; si no llegó, resuelve `DEADLINE` y
 * abandona la promesa (no la cancela — para eso está `opts.signal` de
 * `fetchWithTimeout`). Un timeout por request no alcanza cuando auth-js
 * entra en su loop de refresh (reintenta durante ~30 s ante errores
 * retryable): hace falta este plazo por invocación además del timeout.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), ms);
    unref(timer);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers internos                                                            */
/* -------------------------------------------------------------------------- */

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function unref(timer: ReturnType<typeof setTimeout>) {
  // En Node el timer es un objeto con unref(); en otros runtimes es un número.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref(): void }).unref();
  }
}

type ComposedSignal = { signal: AbortSignal; cleanup: () => void };

/**
 * Combina la señal del timer con las externas. Si alguna externa ya está
 * abortada, la combinada nace abortada (fetch rechaza al instante con ese
 * reason) — así los reintentos de auth-js posteriores a un deadline no abren
 * sockets.
 */
function composeSignals(
  own: AbortSignal,
  ...externals: Array<AbortSignal | null | undefined>
): ComposedSignal {
  const extra = externals.filter((s): s is AbortSignal => s != null);
  if (extra.length === 0) return { signal: own, cleanup: noop };

  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    // AbortSignal.any sostiene a las fuentes por referencia débil: no hay
    // listeners que limpiar.
    return { signal: anyFn([own, ...extra]), cleanup: noop };
  }

  // Fallback manual (Node < 20.3): un controller puente + listeners con
  // limpieza explícita para no acumular handlers en señales longevas.
  const bridge = new AbortController();
  const sources = [own, ...extra];
  const onAbort = (ev: Event) => {
    const src = ev.target as AbortSignal | null;
    bridge.abort(src?.reason);
    cleanup();
  };
  const cleanup = () => {
    for (const s of sources) s.removeEventListener("abort", onAbort);
  };
  for (const s of sources) {
    if (s.aborted) {
      bridge.abort(s.reason);
      return { signal: bridge.signal, cleanup: noop };
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: bridge.signal, cleanup };
}

function noop() {}
