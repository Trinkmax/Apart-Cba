"use client";

import { useEffect, useRef } from "react";
import {
  subscribeResync,
  subscribeTable,
  type ResyncReason,
} from "@/lib/realtime/manager";

type RowBase = { id: string; organization_id?: string };

interface UseRealtimeRowsOptions<Row extends RowBase> {
  table: string;
  organizationId: string;
  schema?: string;
  enabled?: boolean;
  /**
   * Filtro server-side alternativo (ej. `assigned_to=eq.<uuid>`). Por defecto
   * se filtra por `organization_id`. Realtime admite UN solo filtro por
   * suscripción; el alcance de organización lo sigue garantizando la RLS.
   */
  filter?: string;
  onInsert?: (row: Row) => void;
  onUpdate?: (row: Row, old: Partial<Row>) => void;
  onDelete?: (id: string) => void;
  /**
   * Se llama cuando hubo un hueco de eventos (reconexión, vuelta del
   * background, watchdog). Postgres Changes no reenvía nada de lo perdido, así
   * que acá va la re-lectura autoritativa — normalmente `router.refresh()`.
   */
  onResync?: (reason: ResyncReason) => void;
}

/**
 * Suscribe a una tabla del schema `apartcba`. Delega en el manager compartido
 * (`@/lib/realtime/manager`), así que varias pantallas con la misma (tabla,
 * filtro) comparten un canal, y la reconexión, el estado y el re-sync se
 * manejan una sola vez para toda la app.
 */
export function useRealtimeRows<Row extends RowBase>({
  table,
  organizationId,
  schema = "apartcba",
  enabled = true,
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onResync,
}: UseRealtimeRowsOptions<Row>) {
  const handlersRef = useRef({ onInsert, onUpdate, onDelete, onResync });
  useEffect(() => {
    handlersRef.current = { onInsert, onUpdate, onDelete, onResync };
  }, [onInsert, onUpdate, onDelete, onResync]);

  const effectiveFilter = filter ?? `organization_id=eq.${organizationId}`;

  useEffect(() => {
    if (!enabled || !organizationId) return;
    const off = subscribeTable({
      schema,
      table,
      filter: effectiveFilter,
      onChange: (change) => {
        const h = handlersRef.current;
        if (change.eventType === "INSERT") {
          if (change.new) h.onInsert?.(change.new as Row);
          return;
        }
        if (change.eventType === "UPDATE") {
          if (change.new) h.onUpdate?.(change.new as Row, (change.old ?? {}) as Partial<Row>);
          return;
        }
        if (change.id) h.onDelete?.(change.id);
      },
    });
    const offResync = subscribeResync((reason) => handlersRef.current.onResync?.(reason));
    return () => {
      off();
      offResync();
    };
  }, [enabled, organizationId, schema, table, effectiveFilter]);
}
