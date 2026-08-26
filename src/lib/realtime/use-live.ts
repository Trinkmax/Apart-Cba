"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  getLiveSnapshot,
  getServerSnapshot,
  requestResync,
  subscribeResync,
  subscribeStatus,
  subscribeTable,
  type LiveChange,
  type LiveConnection,
  type LiveSnapshot,
  type ResyncReason,
} from "@/lib/realtime/manager";
import { useLiveContext } from "@/lib/realtime/live-context";

export type { LiveChange, LiveConnection, LiveSnapshot, ResyncReason };

/** Estado de la conexión en vivo, compartido por toda la app. */
export function useLiveStatus(): LiveSnapshot {
  return useSyncExternalStore(subscribeStatus, getLiveSnapshot, getServerSnapshot);
}

interface UseLiveTableOptions {
  table: string;
  /** Filtro server-side. Por defecto `organization_id=eq.<org activa>`. */
  filter?: string | null;
  enabled?: boolean;
  onChange?: (change: LiveChange) => void;
  /**
   * Se llama cuando hay que RE-LEER porque pudimos habernos perdido eventos
   * (volvimos del background, volvió la red, se recuperó el canal, el watchdog
   * vio divergencia). Postgres Changes no reenvía nada: esto no es opcional.
   */
  onResync?: (reason: ResyncReason) => void;
}

/**
 * Suscribe a una tabla. Los handlers viajan por ref, así que se pueden escribir
 * inline sin re-suscribir el canal en cada render.
 */
export function useLiveTable({
  table,
  filter,
  enabled = true,
  onChange,
  onResync,
}: UseLiveTableOptions) {
  const ctx = useLiveContext();
  const orgId = ctx?.organizationId ?? null;
  const handlers = useRef({ onChange, onResync });
  useEffect(() => {
    handlers.current = { onChange, onResync };
  }, [onChange, onResync]);

  const explicitFilter = filter !== undefined;
  const effectiveFilter = explicitFilter
    ? filter ?? null
    : orgId
      ? `organization_id=eq.${orgId}`
      : null;
  const active = enabled && (explicitFilter || Boolean(orgId));

  useEffect(() => {
    if (!active) return;
    const offTable = subscribeTable({
      table,
      filter: effectiveFilter,
      onChange: (change) => handlers.current.onChange?.(change),
    });
    const offResync = subscribeResync((reason) => handlers.current.onResync?.(reason));
    return () => {
      offTable();
      offResync();
    };
  }, [active, table, effectiveFilter]);
}

interface UseLiveRefreshOptions {
  /** Tablas cuyo cambio obliga a re-renderizar la pantalla. */
  tables: string[];
  enabled?: boolean;
  /** Mínimo entre dos refresh. Protege de las importaciones masivas de iCal. */
  throttleMs?: number;
  /** Filtro por tabla; por defecto, la organización activa. */
  filterFor?: (table: string) => string | null | undefined;
  /** Devolvé false para ignorar un evento (ej. cambios propios). */
  accept?: (change: LiveChange) => boolean;
  /** Se ejecuta por cada evento aceptado (flash, toast, contador). */
  onAccepted?: (change: LiveChange) => void;
  /**
   * Compuerta: devolvé false mientras no se pueda refrescar sin romper algo
   * (un formulario a medio llenar, un drag en curso, un popover abierto).
   * Lo que se bloquea NO se descarta: queda en `pending` para que la UI ofrezca
   * "N novedades — actualizar".
   */
  canRefresh?: () => boolean;
  /**
   * Red de seguridad opcional: refresca cada N ms mientras la pantalla está
   * visible, haya o no eventos. Se usa donde el filtro del canal no puede
   * cubrir todos los cambios relevantes (ej. una tarea que se reasigna a otra
   * persona: filtrando por `assigned_to` propio, ese evento no llega nunca).
   */
  pollMs?: number;
}

export interface LiveRefreshState {
  connection: LiveConnection;
  /** Hay un refresh en vuelo. */
  isRefreshing: boolean;
  /** epoch ms del último refresh aplicado. */
  lastSyncAt: number | null;
  /** Cambios aceptados que todavía no se reflejaron en pantalla. */
  pending: number;
  /** Aplica los cambios pendientes ahora (botón de la píldora). */
  apply: () => void;
  /** Fuerza re-sync + refresh, ignorando throttle y compuerta. */
  refreshNow: () => void;
}

const isVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Para pantallas renderizadas en el server: cuando cambia algo relevante,
 * `router.refresh()` vuelve a correr el server component y React reconcilia sin
 * perder el estado del cliente (filtros, scroll, diálogos abiertos).
 *
 * El throttle es leading + trailing: el primer evento refresca al toque y una
 * ráfaga (un sync de iCal con 20 reservas) termina en un solo refresh más.
 */
export function useLiveRefresh({
  tables,
  enabled = true,
  throttleMs = 3_000,
  filterFor,
  accept,
  onAccepted,
  canRefresh,
  pollMs,
}: UseLiveRefreshOptions): LiveRefreshState {
  const router = useRouter();
  const ctx = useLiveContext();
  const orgId = ctx?.organizationId ?? null;
  const [isPending, startTransition] = useTransition();
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const status = useLiveStatus();

  const lastRunRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Filas distintas con novedades pendientes. Contar EVENTOS mentía: la
   * ingesta de una reserva de OTA hace insert + update, y la píldora decía
   * "2 novedades" por una sola reserva.
   */
  const pendingKeys = useRef(new Set<string>());
  const cbRef = useRef({ accept, onAccepted, canRefresh, filterFor });
  useEffect(() => {
    cbRef.current = { accept, onAccepted, canRefresh, filterFor };
  }, [accept, onAccepted, canRefresh, filterFor]);

  const run = useCallback(() => {
    lastRunRef.current = Date.now();
    pendingKeys.current.clear();
    setPending(0);
    startTransition(() => {
      router.refresh();
      setLastSyncAt(Date.now());
    });
  }, [router]);

  /** Intenta refrescar respetando throttle, visibilidad y compuerta. */
  const attemptRef = useRef<() => boolean>(() => false);
  /** Devuelve false si la compuerta o la visibilidad lo bloquearon. */
  const attempt = useCallback((): boolean => {
    if (!isVisible()) return false;
    if (cbRef.current.canRefresh && !cbRef.current.canRefresh()) return false;
    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed < throttleMs) {
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          attemptRef.current();
        }, throttleMs - elapsed);
      }
      return true;
    }
    run();
    return true;
  }, [run, throttleMs]);
  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);

  const tablesKey = tables.join(",");
  const active = enabled && Boolean(orgId);

  useEffect(() => {
    if (!active) return;
    const list = tablesKey.split(",").filter(Boolean);
    const offs = list.map((table) => {
      const custom = cbRef.current.filterFor?.(table);
      const filter =
        custom === undefined
          ? orgId
            ? `organization_id=eq.${orgId}`
            : null
          : custom ?? null;
      return subscribeTable({
        table,
        filter,
        onChange: (change) => {
          if (cbRef.current.accept && !cbRef.current.accept(change)) return;
          cbRef.current.onAccepted?.(change);
          pendingKeys.current.add(`${change.table}:${change.id ?? ""}`);
          setPending(pendingKeys.current.size);
          attempt();
        },
      });
    });
    const offResync = subscribeResync(() => {
      // Pudimos habernos perdido eventos: releemos sí o sí, sin throttle.
      lastRunRef.current = 0;
      if (attempt()) return;
      // Bloqueado por la compuerta o por la pestaña oculta: la señal NO se
      // descarta. Queda como novedad pendiente —la píldora la ofrece y el
      // reintento de 1 s la recoge— y le avisamos al manager que todavía no
      // releímos, para que el indicador no vuelva a verde.
      pendingKeys.current.add("resync");
      setPending(pendingKeys.current.size);
      return Promise.reject(new Error("refresh diferido"));
    });
    return () => {
      offs.forEach((off) => off());
      offResync();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, tablesKey, orgId, attempt]);

  useEffect(() => {
    if (!active || !pollMs) return;
    const id = setInterval(() => {
      if (!isVisible()) return;
      lastRunRef.current = 0;
      attempt();
    }, pollMs);
    return () => clearInterval(id);
  }, [active, pollMs, attempt]);

  // Mientras haya novedades retenidas (pestaña oculta o compuerta cerrada),
  // reintentamos: al volver al foreground o al cerrarse el diálogo, entra solo.
  useEffect(() => {
    if (!active || pending === 0) return;
    const tick = () => attempt();
    const id = setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, pending, attempt]);

  const apply = useCallback(() => {
    lastRunRef.current = 0;
    run();
  }, [run]);

  const refreshNow = useCallback(() => {
    lastRunRef.current = 0;
    requestResync();
    run();
  }, [run]);

  return {
    connection: status.connection,
    isRefreshing: isPending,
    lastSyncAt,
    pending,
    apply,
    refreshNow,
  };
}

/**
 * Marca ids "recién cambiados" durante `durationMs` para que la UI los resalte.
 * El resaltado es la mitad del valor del tiempo real: si el cambio no se ve, el
 * equipo no se entera de que algo se movió abajo del cursor.
 */
export function useFlashIds(durationMs = 4_000) {
  const [ids, setIds] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flash = useCallback(
    (id: string | null | undefined) => {
      if (!id) return;
      setIds((prev) => ({ ...prev, [id]: Date.now() }));
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setIds((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, durationMs)
      );
    },
    [durationMs]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const isFlashing = useCallback(
    (id: string | null | undefined) => Boolean(id && ids[id]),
    [ids]
  );

  return { flash, isFlashing, flashingIds: ids };
}
