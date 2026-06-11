"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type InboxRealtimeEvent =
  | { kind: "message_insert"; row: Record<string, unknown> }
  | { kind: "message_update"; row: Record<string, unknown> }
  | { kind: "conv_change"; row: Record<string, unknown> };

interface UseInboxRealtimeOptions {
  /** Vista inbox: filtra server-side todos los eventos por organización. */
  organizationId?: string;
  /** Vista chat: filtra los mensajes por conversación (y omite crm_conversations). */
  conversationId?: string;
}

export function useInboxRealtime(
  { organizationId, conversationId }: UseInboxRealtimeOptions,
  onPayload: (e: InboxRealtimeEvent) => void,
) {
  // Handler via ref para no re-suscribirse en cada render (mismo patrón que use-realtime-rows)
  const handlerRef = useRef(onPayload);
  useEffect(() => {
    handlerRef.current = onPayload;
  }, [onPayload]);

  useEffect(() => {
    if (!organizationId && !conversationId) return;

    const supabase = createClient();
    const messagesFilter = conversationId
      ? `conversation_id=eq.${conversationId}`
      : `organization_id=eq.${organizationId}`;

    const channel = supabase.channel(
      conversationId ? `crm-inbox:conv:${conversationId}` : `crm-inbox:${organizationId}`,
    );

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "apartcba", table: "crm_messages", filter: messagesFilter },
        (p) => handlerRef.current({ kind: "message_insert", row: p.new as Record<string, unknown> }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "apartcba", table: "crm_messages", filter: messagesFilter },
        (p) => handlerRef.current({ kind: "message_update", row: p.new as Record<string, unknown> }),
      );

    if (organizationId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "apartcba", table: "crm_conversations", filter: `organization_id=eq.${organizationId}` },
        (p) => handlerRef.current({ kind: "conv_change", row: p.new as Record<string, unknown> }),
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, conversationId]);
}
