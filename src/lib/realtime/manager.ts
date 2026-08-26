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
 * El manager resuelve cuatro cosas:
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
/** Backoff de reconexión de canal. */
const RETRY_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
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
    if (entry.status !== "down") return;
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
  channel
    .on("postgres_changes", cfg, (payload) => {
      // El canal viejo sigue vivo hasta que termina su leave: sus eventos no
      // pueden mezclarse con los del canal vigente.
      if (entry.channel !== channel) return;
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
    })
    .subscribe((status) => {
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
  const delay = RETRY_STEPS_MS[Math.min(entry.attempt, RETRY_STEPS_MS.length - 1)];
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
const WATCHED_TABLES = ["bookings", "booking_requests"] as const;

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
