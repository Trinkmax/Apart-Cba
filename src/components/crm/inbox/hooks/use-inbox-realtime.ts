"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export type InboxRealtimeEvent =
  | { kind: "message_insert"; row: Record<string, unknown> }
  | { kind: "message_update"; row: Record<string, unknown> }
  | { kind: "conv_change"; row: Record<string, unknown> };

export function useInboxRealtime(onPayload: (e: InboxRealtimeEvent) => void) {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`crm-inbox`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "apartcba", table: "crm_messages" },
        (p) => onPayload({ kind: "message_insert", row: p.new as Record<string, unknown> }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "apartcba", table: "crm_messages" },
        (p) => onPayload({ kind: "message_update", row: p.new as Record<string, unknown> }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "apartcba", table: "crm_conversations" },
        (p) => onPayload({ kind: "conv_change", row: p.new as Record<string, unknown> }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onPayload]);
}
