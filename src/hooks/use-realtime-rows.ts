"use client";

import { useEffect, useRef } from "react";
import type {
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type RowBase = { id: string; organization_id?: string };

interface UseRealtimeRowsOptions<Row extends RowBase> {
  table: string;
  organizationId: string;
  schema?: string;
  enabled?: boolean;
  onInsert?: (row: Row) => void;
  onUpdate?: (row: Row, old: Partial<Row>) => void;
  onDelete?: (id: string) => void;
}

/**
 * Suscribe a una tabla del schema apartcba via Supabase Realtime con un único
 * canal por board. Filtra server-side por organization_id y delega los handlers
 * via ref para no re-suscribirse cuando cambian las funciones inline. La RLS
 * (members_all) actúa como segunda barrera por org.
 */
export function useRealtimeRows<Row extends RowBase>({
  table,
  organizationId,
  schema = "apartcba",
  enabled = true,
  onInsert,
  onUpdate,
  onDelete,
}: UseRealtimeRowsOptions<Row>) {
  const handlersRef = useRef({ onInsert, onUpdate, onDelete });
  useEffect(() => {
    handlersRef.current = { onInsert, onUpdate, onDelete };
  }, [onInsert, onUpdate, onDelete]);

  useEffect(() => {
    if (!enabled || !organizationId) return;

    const supabase = createClient();
    const filter = `organization_id=eq.${organizationId}`;
    const channel = supabase
      .channel(`rt:${schema}:${table}:${organizationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema, table, filter },
        (payload: RealtimePostgresInsertPayload<Row>) => {
          handlersRef.current.onInsert?.(payload.new);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema, table, filter },
        (payload: RealtimePostgresUpdatePayload<Row>) => {
          handlersRef.current.onUpdate?.(payload.new, payload.old as Partial<Row>);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema, table, filter },
        (payload: RealtimePostgresDeletePayload<Row>) => {
          const id = (payload.old as { id?: string }).id;
          if (id) handlersRef.current.onDelete?.(id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, schema, table]);
}
