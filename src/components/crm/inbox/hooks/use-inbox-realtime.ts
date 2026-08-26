"use client";

import { useEffect, useRef } from "react";
import { subscribeResync, subscribeTable } from "@/lib/realtime/manager";
import type { ResyncReason } from "@/lib/realtime/manager";

export type InboxRealtimeEvent =
  | { kind: "message_insert"; row: Record<string, unknown> }
  | { kind: "message_update"; row: Record<string, unknown> }
  | { kind: "conv_change"; row: Record<string, unknown> };

interface UseInboxRealtimeOptions {
  /** Vista inbox: filtra server-side todos los eventos por organización. */
  organizationId?: string;
  /** Vista chat: filtra los mensajes por conversación (y omite crm_conversations). */
  conversationId?: string;
  /**
   * Se llama cuando hubo un hueco de eventos (reconexión, vuelta del
   * background). El inbox tiene que re-pedir: un mensaje entrante que llegó
   * con el socket caído no se reenvía nunca.
   */
  onResync?: (reason: ResyncReason) => void;
}

/**
 * Realtime del inbox de CRM. Delega en el manager compartido, así que hereda
 * la reconexión con backoff, el estado de conexión y el bus de re-sync que
 * antes no existían acá (el `.subscribe()` iba sin callback de estado).
 */
export function useInboxRealtime(
  { organizationId, conversationId, onResync }: UseInboxRealtimeOptions,
  onPayload: (e: InboxRealtimeEvent) => void,
) {
  const handlerRef = useRef({ onPayload, onResync });
  useEffect(() => {
    handlerRef.current = { onPayload, onResync };
  }, [onPayload, onResync]);

  useEffect(() => {
    if (!organizationId && !conversationId) return;

    const messagesFilter = conversationId
      ? `conversation_id=eq.${conversationId}`
      : `organization_id=eq.${organizationId}`;

    const offs = [
      subscribeTable({
        table: "crm_messages",
        filter: messagesFilter,
        onChange: (change) => {
          if (!change.new) return;
          if (change.eventType === "INSERT") {
            handlerRef.current.onPayload({ kind: "message_insert", row: change.new });
          } else if (change.eventType === "UPDATE") {
            handlerRef.current.onPayload({ kind: "message_update", row: change.new });
          }
        },
      }),
    ];

    if (organizationId && !conversationId) {
      offs.push(
        subscribeTable({
          table: "crm_conversations",
          filter: `organization_id=eq.${organizationId}`,
          onChange: (change) => {
            if (!change.new) return;
            handlerRef.current.onPayload({ kind: "conv_change", row: change.new });
          },
        }),
      );
    }

    const offResync = subscribeResync((reason) => handlerRef.current.onResync?.(reason));

    return () => {
      offs.forEach((off) => off());
      offResync();
    };
  }, [organizationId, conversationId]);
}
