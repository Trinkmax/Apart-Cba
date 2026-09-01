"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Capa "en vivo" compartida del PMS.
 *
 * Por qué existe: cada pantalla que se suscribía por su cuenta abría su propio
 * canal, no reintentaba si el canal se caía, y —lo más grave— **los eventos que
 * ocurren mientras el navegador está dormido o sin red se pierden para
 * siempre**. Postgres Changes no tiene replay. Ése es el agujero que hacía que
 * el equipo viera disponibilidad en el calendario cuando la reserva ya estaba
 * cargada hacía rato: la pestaña seguía "conectada" pero le faltaban minutos de
 * historia y nada se lo iba a decir.
 *
 * El manager resuelve cinco cosas:
 *   1. **Multiplexa** — un canal por (tabla, filtro) con ref-count, sin importar
 *      cuántos componentes lo pidan.
 *   2. **Se repara** — lee el callback de estado del canal (que hoy nadie leía),
 *      reintenta con backoff y reporta el estado real a la UI.
 *   3. **Re-sincroniza** — emite `resync` al volver del background, al volver la
 *      red, al recuperarse un canal y cuando el watchdog detecta divergencia.
 *      Los consumidores usan esa señal para RE-LEER, porque nadie les va a
 *      reenviar lo que se perdieron.
 *   4. **No miente** — si la sesión se cae, supabase-js manda la anon key como
 *      token a los canales ya unidos: la RLS deja de matchear, el canal sigue
 *      "joined" y no llega un solo evento más, sin ningún error. Acá eso se
 *      detecta y el indicador se pone en rojo en vez de quedar en verde.
 *   5. **Nunca se une sin sesión** — ver `openChannel`. En supabase-js 2.104
 *      `subscribe()` lee el token del socket de forma SINCRÓNICA mientras
 *      `connect()` todavía está esperando `auth.getSession()`: en un cliente
 *      recién creado el primer join de cada canal sale con la anon key. El
 *      server lo acepta (SUBSCRIBED) y recién después falla la suscripción a
 *      Postgres — de forma asíncrona, fatal y sin reintento — con
 *      "invalid column for filter organization_id": `realtime.subscription_check_filters`
 *      arma las columnas permitidas con `has_column_privilege(rol, …)` y el rol
 *      `anon` no tiene ningún grant en `apartcba.*`. Resultado: canal verde y
 *      mudo hasta el próximo cambio de token. Acá se espera la sesión, se
 *      aplica el token al socket y recién entonces se hace el join.
 */

export type LiveEventType = "INSERT" | "UPDATE" | "DELETE";

export interface LiveChange<Row = Record<string, unknown>> {
  table: string;
  eventType: LiveEventType;
  id: string | null;
  new: Row | null;
  old: Partial<Row> | null;
}

export type ResyncReason =
  | "reconnect"
  | "visible"
  | "online"
  | "restored"
  | "watchdog"
  | "auth"
  | "manual";

export type LiveConnection =
  /** primera conexión en curso */
  | "connecting"
  /** todo al día */
  | "live"
  /** se cayó un canal, reintentando */
  | "reconnecting"
  /** el navegador no tiene red */
  | "offline"
  /** el watchdog vio datos más nuevos que el último evento recibido */
  | "stale"
  /** la sesión se venció: hay que recargar, no hay nada que reintentar */
  | "auth-lost";

export interface LiveSnapshot {
  connection: LiveConnection;
  /** epoch ms del último evento recibido (cualquier tabla suscripta) */
  lastEventAt: number | null;
  /** epoch ms del último re-sync disparado */
  lastResyncAt: number | null;
  /** cantidad de canales activos — debug */
  channels: number;
}

export interface LiveSubscription {
  table: string;
  /** Filtro server-side de Realtime, ej. `organization_id=eq.<uuid>`. */
  filter?: string | null;
  schema?: string;
  onChange?: (change: LiveChange) => void;
}

/** Cuánto tiene que haber estado oculta la pestaña para forzar re-sync. */
const HIDDEN_RESYNC_MS = 15_000;
/** Piso entre dos re-syncs, para que no se encadenen. */
const RESYNC_COOLDOWN_MS = 2_500;
/**
 * Backoff de reconexión de canal. Los pasos nunca se "agotan": una vez en el
 * último, se queda ahí (60 s) hasta que algo resetee `attempt` (SUBSCRIBED,
 * nudgeSocket, online). Antes el techo era 15 s para siempre: en un corte
 * largo como el del 29/8 eran cuatro joins por minuto por canal por pestaña.
 */
const RETRY_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000];
/** Jitter ±20 % sobre el backoff, para que las pestañas no se sincronicen. */
const RETRY_JITTER = 0.2;
/**
 * Cuánto esperamos a `auth.getSession()` antes de dar el join por caído.
 * getSession() espera la inicialización del cliente y toma el navigator lock
 * cross-tab: en un incidente de Auth (29/8: /auth/v1/token en 23 s) puede
 * colgarse. Preferimos un canal "down" con retry a un join sin token.
 */
const SESSION_WAIT_MS = 10_000;
/** Cada cuánto el watchdog compara contra la base (sólo con pestaña visible). */
const WATCHDOG_MS = 90_000;
/** Piso entre dos corridas del watchdog fuera de su intervalo. */
const WATCHDOG_MIN_GAP_MS = 10_000;
/** Sondeos fallidos seguidos antes de admitir que no podemos verificar nada. */
const WATCHDOG_FAIL_LIMIT = 3;

type EntryStatus = "connecting" | "live" | "down";

interface Entry {
  key: string;
  schema: string;
  table: string;
  filter: string | null;
  channel: RealtimeChannel | null;
  subs: Set<LiveSubscription>;
  status: EntryStatus;
  everLive: boolean;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * Fallos seguidos de la suscripción a Postgres (mensaje `system` con
   * status "error" DESPUÉS de un join ok). Como SUBSCRIBED resetea `attempt`
   * antes de que llegue ese mensaje, sin este contador un fallo persistente
   * (filtro inválido para el rol, etc.) reintentaría cada 1 s para siempre,
   * con un resync por rejoin. Se usa para escalar el backoff igual.
   */
  pgSubErrors: number;
}

const entries = new Map<string, Entry>();
const statusListeners = new Set<() => void>();
type ResyncListener = (reason: ResyncReason) => void | Promise<unknown>;
const resyncListeners = new Set<ResyncListener>();

let snapshot: LiveSnapshot = {
  connection: "connecting",
  lastEventAt: null,
  lastResyncAt: null,
  channels: 0,
};

let browserWired = false;
let hiddenSince: number | null = null;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let online = true;
let authOk = true;
let stale = false;
/**
 * Topic monotónico. `removeChannel()` es asíncrono y deja el canal en estado
 * `leaving`; si se vuelve a pedir el MISMO topic antes de que termine, se
 * recibe ese canal muerto, `.subscribe()` es no-op y el componente queda mudo
 * para siempre sin ninguna señal. Un topic nuevo por apertura lo evita.
 */
let topicSeq = 0;

function keyOf(schema: string, table: string, filter: string | null) {
  return `${schema}.${table}|${filter ?? "*"}`;
}

function computeConnection(): LiveConnection {
  if (!authOk) return "auth-lost";
  if (!online) return "offline";
  if (entries.size === 0) return "live";
  let anyLive = false;
  let anyDown = false;
  let anyConnecting = false;
  entries.forEach((e) => {
    if (e.status === "live") anyLive = true;
    else if (e.status === "down") anyDown = true;
    else anyConnecting = true;
  });
  if (anyDown) return "reconnecting";
  if (anyConnecting) return anyLive ? "reconnecting" : "connecting";
  return stale ? "stale" : "live";
}

function publish(patch: Partial<LiveSnapshot> = {}) {
  const next: LiveSnapshot = {
    ...snapshot,
    ...patch,
    connection: computeConnection(),
    channels: entries.size,
  };
  if (
    next.connection === snapshot.connection &&
    next.lastEventAt === snapshot.lastEventAt &&
    next.lastResyncAt === snapshot.lastResyncAt &&
    next.channels === snapshot.channels
  ) {
    return;
  }
  snapshot = next;
  statusListeners.forEach((fn) => fn());
}

// ── Re-sync ────────────────────────────────────────────────────────────────
// La señal central del módulo: "puede que te hayas perdido cosas, releé".

function fireResync(reason: ResyncReason, force = false) {
  const now = Date.now();
  if (!force && snapshot.lastResyncAt && now - snapshot.lastResyncAt < RESYNC_COOLDOWN_MS) {
    // El cooldown DEMORA el pedido, no se lo come: si lo descartáramos, un
    // watchdog que detectó divergencia dejaría el indicador en ámbar para
    // siempre y la re-lectura no ocurriría nunca.
    if (!resyncTimer) {
      const wait = RESYNC_COOLDOWN_MS - (now - (snapshot.lastResyncAt ?? 0));
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        fireResync(reason);
      }, Math.max(50, wait));
    }
    return;
  }
  publish({ lastResyncAt: now });

  // `stale` se apaga recién cuando los consumidores confirman que releyeron.
  // Apagarlo antes es exactamente la mentira que este módulo existe para
  // evitar: verde en pantalla con una re-lectura que falló.
  const results = Array.from(resyncListeners).map((fn) => {
    try {
      return Promise.resolve(fn(reason));
    } catch (err) {
      return Promise.reject(err);
    }
  });
  void Promise.allSettled(results).then((rs) => {
    if (rs.every((r) => r.status === "fulfilled")) {
      if (stale) {
        stale = false;
        publish();
      }
    }
  });
}

function scheduleResync(reason: ResyncReason) {
  if (resyncTimer) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    fireResync(reason);
  }, 250);
}

/** Empuja el socket cuando volvemos del background y quedó muerto. */
function nudgeSocket() {
  try {
    const supabase = createClient();
    if (!supabase.realtime.isConnected()) supabase.realtime.connect();
  } catch {
    /* noop */
  }
  entries.forEach((entry) => {
    // "down" cubre también los canales que quedaron creados pero SIN join por
    // falta de sesión (ver openChannel): al recuperarla, se reabren desde acá.
    if (entry.status !== "down" && entry.channel) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.attempt = 0;
    closeChannel(entry);
    openChannel(entry);
  });
}

function wireBrowser() {
  if (browserWired || typeof window === "undefined") return;
  browserWired = true;
  online = navigator.onLine !== false;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenSince = Date.now();
      return;
    }
    const away = hiddenSince ? Date.now() - hiddenSince : 0;
    hiddenSince = null;
    nudgeSocket();
    runWatchdog();
    // Volver de un vistazo de dos segundos no amerita releer todo; volver de un
    // almuerzo —o del celular bloqueado en el bolsillo— sí.
    if (away >= HIDDEN_RESYNC_MS) scheduleResync("visible");
  });

  // bfcache (iOS sobre todo): la página vuelve entera desde memoria, sin
  // re-render y con el socket muerto. Sin esto, "volver atrás" muestra ayer.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) {
      nudgeSocket();
      scheduleResync("restored");
    }
  });

  window.addEventListener("online", () => {
    online = true;
    publish();
    nudgeSocket();
    scheduleResync("online");
  });

  window.addEventListener("offline", () => {
    online = false;
    publish();
  });

  // Sesión: si se pierde, supabase-js empieza a mandar la anon key a los
  // canales ya unidos y la RLS los deja mudos sin emitir ningún error.
  // Y al revés: si un canal quedó sin join por falta de sesión (openChannel
  // pone authOk=false sin programar retry), el SIGNED_IN / TOKEN_REFRESHED
  // que llegue por acá es lo que lo reabre, vía nudgeSocket.
  try {
    const supabase = createClient();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        authOk = false;
        publish();
        return;
      }
      const has = Boolean(session);
      if (has && !authOk) {
        authOk = true;
        publish();
        nudgeSocket();
        scheduleResync("auth");
        return;
      }
      if (!has && event !== "INITIAL_SESSION") {
        authOk = false;
        publish();
      }
    });
  } catch {
    /* noop */
  }
}

// ── Canales ────────────────────────────────────────────────────────────────

/**
 * Mensaje `system` que el server manda DESPUÉS del join ok, cuando termina (o
 * falla) la suscripción real a Postgres. Con `status: "error"` la suscripción
 * es fatal y el server no reintenta: el canal queda "joined" y mudo hasta
 * que reciba un `access_token` nuevo. realtime-js no expone este evento (no
 * hay overload de `on()` para "system"), pero en runtime `_on`/`_trigger`
 * despachan por tipo, así que se escucha con un cast local.
 */
interface SystemPayload {
  extension?: string;
  status?: string;
  message?: string;
  channel?: string;
}
type OnSystem = (
  type: "system",
  filter: Record<string, never>,
  callback: (payload: SystemPayload | undefined) => void
) => RealtimeChannel;

/** `Promise.race` con timeout que no deja el timer colgado. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Crea el canal SINCRÓNICAMENTE (así `realtime.channels` nunca queda en 0:
 * `removeChannel()` desconecta el socket cuando eso pasa) y difiere sólo el
 * `subscribe()` hasta tener sesión y token aplicados al socket. Ver punto 5
 * del comentario de cabecera.
 */
function openChannel(entry: Entry) {
  const supabase = createClient();
  const cfg = {
    event: "*" as const,
    schema: entry.schema,
    table: entry.table,
    ...(entry.filter ? { filter: entry.filter } : {}),
  };

  entry.status = entry.everLive ? "down" : "connecting";
  topicSeq += 1;
  const channel = supabase.channel(`live:${entry.key}#${topicSeq}`);
  entry.channel = channel;
  // Se registra ANTES de subscribe(): después del join no se pueden agregar
  // bindings. Si Postgres rechaza la suscripción (típicamente "invalid column
  // for filter organization_id": claims con rol anon → has_column_privilege
  // devuelve false para toda columna de apartcba.*), el canal ya está
  // SUBSCRIBED y no va a emitir nada más. Lo bajamos y reintentamos con
  // sesión; sin sesión, retryLater lo frena.
  (channel.on as unknown as OnSystem)("system", {}, (payload) => {
    if (entry.channel !== channel) return;
    if (payload?.extension !== "postgres_changes") return;
    if (payload.status === "ok") {
      entry.pgSubErrors = 0;
      return;
    }
    if (payload.status !== "error") return;
    // SUBSCRIBED ya puso attempt en 0: si no escalamos acá, un fallo
    // persistente sería un rejoin por segundo (y un resync por rejoin).
    entry.pgSubErrors += 1;
    entry.attempt = Math.max(entry.attempt, entry.pgSubErrors);
    entry.status = "down";
    publish();
    retryLater(entry);
  });
  channel
    .on("postgres_changes", cfg, (payload) => {
      // El canal viejo sigue vivo hasta que termina su leave: sus eventos no
      // pueden mezclarse con los del canal vigente.
      if (entry.channel !== channel) return;
      // Llegó un evento: la suscripción a Postgres funciona.
      entry.pgSubErrors = 0;
      const row = (payload.new ?? null) as Record<string, unknown> | null;
      const old = (payload.old ?? null) as Record<string, unknown> | null;
      const id =
        (row?.id as string | undefined) ?? (old?.id as string | undefined) ?? null;
      const change: LiveChange = {
        table: entry.table,
        eventType: payload.eventType as LiveEventType,
        id,
        new: row,
        old,
      };
      noteWatermark(entry.table, row);
      publish({ lastEventAt: Date.now() });
      entry.subs.forEach((sub) => {
        try {
          sub.onChange?.(change);
        } catch {
          /* idem */
        }
      });
    });

  void joinWhenAuthenticated(entry, channel);
}

/**
 * Segunda mitad de `openChannel`: espera la sesión, aplica el token al socket
 * y recién ahí hace el join. Cada `await` puede volver a un mundo distinto
 * (release() por StrictMode, retry, nudgeSocket): la guarda
 * `entry.channel !== channel` aborta la continuación en ese caso.
 */
async function joinWhenAuthenticated(entry: Entry, channel: RealtimeChannel) {
  const supabase = createClient();
  const abandoned = () => entry.channel !== channel || entry.subs.size === 0;

  let accessToken: string | null = null;
  let timedOut = false;
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), SESSION_WAIT_MS);
    accessToken = data.session?.access_token ?? null;
  } catch {
    // getSession() colgado (Auth degradado o lock cross-tab): no sabemos si
    // hay sesión. No es auth-lost; es "todavía no", con retry acotado.
    timedOut = true;
  }
  if (abandoned()) return;

  if (timedOut) {
    entry.status = "down";
    publish();
    retryLater(entry);
    return;
  }

  if (!accessToken) {
    // Sin sesión no hay join posible: con la anon key el server aceptaría el
    // canal y la suscripción a Postgres fallaría muda. Se deja el canal
    // creado (sin join) y en "down", SIN timer: la recuperación viene por
    // onAuthStateChange → nudgeSocket, que reabre las entradas "down".
    authOk = false;
    entry.status = "down";
    publish();
    return;
  }

  // Sin argumento mantiene el modo callback (supabase-js alterna entre manual
  // y callback todo el tiempo, no cambiamos el régimen). Lo que importa es
  // que después de este await `accessTokenValue` sea el JWT del usuario,
  // porque subscribe() lo lee de forma sincrónica para armar el join.
  try {
    await supabase.realtime.setAuth();
  } catch {
    /* se verifica abajo */
  }
  if (abandoned()) return;

  if (supabase.realtime.accessTokenValue !== accessToken) {
    // O bien el socket no tomó el token, o la sesión rotó entre los dos
    // awaits. En ningún caso hacemos el join a ciegas: el retry vuelve a
    // pasar por acá con la sesión vigente. Si de verdad no hay sesión,
    // retryLater queda frenado por authOk en el próximo intento.
    entry.status = "down";
    publish();
    retryLater(entry);
    return;
  }

  channel.subscribe((status) => {
    // GUARDA CRÍTICA. `removeChannel()` dispara un CLOSED del canal viejo —y
    // lo dispara SINCRÓNICAMENTE, porque phoenix pone el canal en `leaving`
    // antes de evaluar `canPush()` y resuelve el leavePush en el acto. Sin
    // esta comparación, cerrar un canal para reabrirlo re-armaba el retry, y
    // el retry volvía a cerrar: churn infinito de canal, un `resync` cada
    // 2,5 s y un router.refresh() por pestaña, para siempre, con el
    // indicador en verde.
    if (entry.channel !== channel) return;

    if (status === "SUBSCRIBED") {
      const recovering = entry.everLive;
      entry.status = "live";
      entry.everLive = true;
      entry.attempt = 0;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      publish();
      // Se cayó y volvió ⇒ quedó un hueco de eventos que nadie va a reenviar.
      if (recovering) scheduleResync("reconnect");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      entry.status = "down";
      publish();
      retryLater(entry);
    }
  });
}

function retryLater(entry: Entry) {
  if (entry.timer || entry.subs.size === 0 || entry.status === "live") return;
  // Sin sesión no se reintenta: cada intento sería un join con la anon key
  // (SUBSCRIBED + suscripción a Postgres fallida y muda). Cuando vuelva la
  // sesión, el handler de auth hace nudgeSocket() y reabre desde attempt=0.
  if (!authOk) return;
  const base = RETRY_STEPS_MS[Math.min(entry.attempt, RETRY_STEPS_MS.length - 1)];
  const jitter = 1 + (Math.random() * 2 - 1) * RETRY_JITTER;
  const delay = Math.round(base * jitter);
  entry.attempt += 1;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.subs.size === 0) return;
    closeChannel(entry);
    openChannel(entry);
  }, delay);
}

function closeChannel(entry: Entry) {
  if (!entry.channel) return;
  const channel = entry.channel;
  entry.channel = null;
  try {
    createClient().removeChannel(channel);
  } catch {
    /* noop */
  }
}

// ── Watchdog ───────────────────────────────────────────────────────────────
// Última línea de defensa contra el modo de falla silencioso: el canal dice
// estar vivo pero no llega nada. Comparamos el `updated_at` más nuevo de la
// base contra el más nuevo que vimos pasar. Si la base va adelante, avisamos.

let watchdogOrgId: string | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogRunning = false;
let lastWatchdogAt = 0;
let probeFailures = 0;
const watermarks = new Map<string, number>();
/** Tablas que el watchdog vigila. Sólo lo que puede costar una venta doble. */
// `channel_reservations` entra porque una solicitud nueva o caída cambia lo que
// muestra la grilla sin pasar por `bookings`: sin vigilarla, el watchdog no
// detecta divergencia y la capa ámbar queda vieja hasta navegar.
const WATCHED_TABLES = ["bookings", "booking_requests", "channel_reservations"] as const;

function noteWatermark(table: string, row: Record<string, unknown> | null) {
  const value = row?.updated_at;
  if (typeof value !== "string") return;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return;
  const current = watermarks.get(table);
  if (current === undefined || ms > current) watermarks.set(table, ms);
}

/** ¿Alguien en esta pestaña está realmente escuchando esta tabla? */
function hasLiveSubscription(table: string): boolean {
  for (const e of entries.values()) {
    if (e.table === table && e.subs.size > 0) return true;
  }
  return false;
}

async function runWatchdog() {
  if (!watchdogOrgId || watchdogRunning) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (!online || !authOk) return;
  if (Date.now() - lastWatchdogAt < WATCHDOG_MIN_GAP_MS) return;
  watchdogRunning = true;
  lastWatchdogAt = Date.now();

  try {
    const supabase = createClient();
    // Si no hay sesión, supabase-js ya está mandando la anon key a los canales
    // unidos: se ven "joined" y no va a llegar nada más. Eso es auth-lost, no
    // "todo bien".
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      authOk = false;
      publish();
      return;
    }
    let diverged = false;
    let failed = false;
    for (const table of WATCHED_TABLES) {
      // Comparar contra la base una tabla que nadie escucha sólo produce
      // ámbar y refrescos inútiles (ej. limpieza en /m, que no ve reservas).
      if (!hasLiveSubscription(table)) {
        watermarks.delete(table);
        continue;
      }
      const { data, error } = await supabase
        .from(table)
        .select("updated_at")
        .eq("organization_id", watchdogOrgId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        failed = true;
        continue;
      }
      const dbValue = (data as { updated_at?: string } | null)?.updated_at;
      if (typeof dbValue !== "string") continue;
      const dbMs = Date.parse(dbValue);
      if (Number.isNaN(dbMs)) continue;
      const seen = watermarks.get(table);
      if (seen === undefined) {
        watermarks.set(table, dbMs);
        continue;
      }
      // Un segundo de margen: los relojes del cliente y del server no son el
      // mismo, y no queremos un re-sync espurio por 200 ms de deriva.
      if (dbMs > seen + 1_000) {
        watermarks.set(table, dbMs);
        diverged = true;
      }
    }
    if (failed) {
      probeFailures += 1;
      // El watchdog es el ÚNICO detector de la falla silenciosa. Si él también
      // falla varias veces seguidas, no podemos afirmar que el dato esté al
      // día: lo decimos, en vez de dejar el verde puesto.
      if (probeFailures >= WATCHDOG_FAIL_LIMIT && !stale) {
        stale = true;
        publish();
      }
    } else {
      probeFailures = 0;
    }

    if (diverged) {
      stale = true;
      publish();
      scheduleResync("watchdog");
    }
  } catch {
    probeFailures += 1;
    if (probeFailures >= WATCHDOG_FAIL_LIMIT && !stale) {
      stale = true;
      publish();
    }
  } finally {
    watchdogRunning = false;
  }
}

/** Arranca el watchdog para una organización. Idempotente. */
export function startWatchdog(organizationId: string) {
  if (typeof window === "undefined") return;
  if (watchdogOrgId === organizationId && watchdogTimer) return;
  watchdogOrgId = organizationId;
  watermarks.clear();
  probeFailures = 0;
  lastWatchdogAt = 0;
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(runWatchdog, WATCHDOG_MS);
  void runWatchdog();
}

export function stopWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
  watchdogOrgId = null;
  watermarks.clear();
  probeFailures = 0;
}

// ── API pública ────────────────────────────────────────────────────────────

/**
 * Suscribe a los cambios de una tabla. Devuelve la función de baja.
 * Varios llamados con la misma (tabla, filtro) comparten un solo canal.
 */
export function subscribeTable(sub: LiveSubscription): () => void {
  if (typeof window === "undefined") return () => {};
  wireBrowser();

  const schema = sub.schema ?? "apartcba";
  const filter = sub.filter ?? null;
  const key = keyOf(schema, sub.table, filter);

  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      schema,
      table: sub.table,
      filter,
      channel: null,
      subs: new Set(),
      status: "connecting",
      everLive: false,
      attempt: 0,
      pgSubErrors: 0,
      timer: null,
    };
    entries.set(key, entry);
    entry.subs.add(sub);
    openChannel(entry);
    publish();
    return () => release(key, sub);
  }
  entry.subs.add(sub);
  return () => release(key, sub);
}

function release(key: string, sub: LiveSubscription) {
  const current = entries.get(key);
  if (!current) return;
  current.subs.delete(sub);
  if (current.subs.size > 0) return;
  if (current.timer) {
    clearTimeout(current.timer);
    current.timer = null;
  }
  closeChannel(current);
  entries.delete(key);
  publish();
}

/** Escucha el bus de re-sincronización. Devuelve la función de baja. */
export function subscribeResync(fn: ResyncListener): () => void {
  resyncListeners.add(fn);
  return () => {
    resyncListeners.delete(fn);
  };
}

/** Para `useSyncExternalStore`. */
export function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

export function getLiveSnapshot(): LiveSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: LiveSnapshot = {
  connection: "connecting",
  lastEventAt: null,
  lastResyncAt: null,
  channels: 0,
};

export function getServerSnapshot(): LiveSnapshot {
  return SERVER_SNAPSHOT;
}

/** Fuerza un re-sync (el botón "actualizar" de la UI). */
export function requestResync() {
  nudgeSocket();
  lastWatchdogAt = 0;
  void runWatchdog();
  fireResync("manual", true);
}
