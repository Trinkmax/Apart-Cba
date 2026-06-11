"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { MessageBubble } from "./message-bubble";
import { getConversationDetail, sendTextMessage } from "@/lib/actions/crm-conversations";
import { useInboxRealtime } from "./hooks/use-inbox-realtime";
import type { CrmConversationListItem, CrmContactWithLinks, CrmMessage } from "@/lib/types/database";

interface Props {
  conversationId: string;
  initial: {
    conversation: CrmConversationListItem;
    contact: CrmContactWithLinks;
    messages: CrmMessage[];
  };
}

export function MobileChat({ conversationId, initial }: Props) {
  const [messages, setMessages] = useState<CrmMessage[]>(initial.messages);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filtro server-side por conversación: solo llegan mensajes de este chat.
  useInboxRealtime({ conversationId }, (event) => {
    if (event.kind === "message_insert") {
      // Append incremental de la fila entrante (idempotente por id) en vez de
      // re-fetchear todo el detalle (select * limit 500 + 3 queries) por mensaje.
      const row = event.row as unknown as CrmMessage;
      if (!row?.id) return;
      setMessages((prev) =>
        prev.some((m) => m.id === row.id) ? prev : [...prev, row]
      );
    } else if (event.kind === "message_update") {
      // Status del mensaje (enviado→entregado→leído): merge en su lugar.
      const row = event.row as unknown as CrmMessage;
      if (!row?.id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === row.id ? { ...m, ...row } : m))
      );
    }
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const sessionExpired = !initial.conversation.last_customer_message_at ||
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(initial.conversation.last_customer_message_at).getTime() > 24 * 3_600_000;

  const handleSend = () => {
    if (!draft.trim()) return;
    startTransition(async () => {
      try {
        await sendTextMessage({ conversationId, text: draft.trim() });
        setDraft("");
        const fresh = await getConversationDetail(conversationId);
        if (fresh) setMessages(fresh.messages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(msg.includes("session_expired") ? "Ventana 24h expirada — usá template" : msg);
      }
    });
  };

  return (
    <>
      <ScrollArea className="flex-1" ref={scrollRef as unknown as React.RefObject<HTMLDivElement>}>
        <div className="p-3 space-y-2">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">Sin mensajes</p>
          ) : messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        </div>
      </ScrollArea>
      {sessionExpired ? (
        <div className="border-t border-border p-3 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 text-center">
          Ventana 24h expirada — usá template desde desktop
        </div>
      ) : (
        <div className="border-t border-border p-2 flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Mensaje..."
            className="min-h-9 max-h-32 resize-none flex-1 text-sm"
            rows={1}
            disabled={isPending}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!draft.trim() || isPending}
            className="bg-emerald-500 hover:bg-emerald-600 text-white h-9 shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>
      )}
    </>
  );
}
