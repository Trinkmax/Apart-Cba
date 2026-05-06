"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Info, RotateCcw, Send, Paperclip, Sparkles, Moon, Archive } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { SessionTimer } from "@/components/crm/shared/session-timer";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { ProviderBadge } from "@/components/crm/shared/provider-badge";
import { MessageBubble } from "./message-bubble";
import { QuickReplyPicker } from "./quick-reply-picker";
import {
  getConversationDetail, sendTextMessage, closeConversation, reopenConversation,
  snoozeConversation, archiveConversation,
} from "@/lib/actions/crm-conversations";
import { formatPhoneForDisplay } from "@/lib/crm/phone";
import type {
  CrmChannelProvider,
  CrmConversationListItem,
  CrmContactWithLinks,
  CrmMessage,
  CrmTag,
} from "@/lib/types/database";

interface Props {
  conversationId: string;
  tags: CrmTag[];
  onContextToggle: () => void;
  contextPanelOpen: boolean;
}

interface Detail {
  conversation: CrmConversationListItem;
  messages: CrmMessage[];
  contact: CrmContactWithLinks;
}

export function ChatPane({ conversationId, onContextToggle, contextPanelOpen }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getConversationDetail(conversationId).then((d) => {
      if (!cancelled) setDetail(d ?? null);
    });
    return () => { cancelled = true; };
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail?.messages.length]);

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Cargando conversación…
      </div>
    );
  }

  const { conversation, messages, contact } = detail;
  const isClosed = conversation.status === "closed";
  const sessionExpired = !conversation.last_customer_message_at ||
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(conversation.last_customer_message_at).getTime() > 24 * 3_600_000;

  const labelForInitials = contact.name ?? contact.instagram_username ?? contact.phone ?? contact.external_id ?? "?";
  const initials = labelForInitials
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const handleSend = () => {
    if (!draft.trim()) return;
    startTransition(async () => {
      try {
        await sendTextMessage({ conversationId, text: draft.trim() });
        setDraft("");
        const fresh = await getConversationDetail(conversationId);
        if (fresh) setDetail(fresh);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error";
        if (msg.includes("session_expired")) {
          toast.error("Ventana 24h expirada — usá un template aprobado");
        } else {
          toast.error(msg);
        }
      }
    });
  };

  const handleClose = () => {
    startTransition(async () => {
      await closeConversation(conversationId);
      const fresh = await getConversationDetail(conversationId);
      if (fresh) setDetail(fresh);
    });
  };

  const handleReopen = () => {
    startTransition(async () => {
      await reopenConversation(conversationId);
      const fresh = await getConversationDetail(conversationId);
      if (fresh) setDetail(fresh);
    });
  };

  const handleSnooze = (hours: number) => {
    startTransition(async () => {
      const until = new Date(Date.now() + hours * 3_600_000);
      await snoozeConversation(conversationId, until);
      toast.success(`Pausada por ${hours}h`);
      const fresh = await getConversationDetail(conversationId);
      if (fresh) setDetail(fresh);
    });
  };

  const handleArchive = () => {
    if (!confirm("¿Archivar esta conversación?")) return;
    startTransition(async () => {
      await archiveConversation(conversationId);
      const fresh = await getConversationDetail(conversationId);
      if (fresh) setDetail(fresh);
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <Avatar className="size-9">
              {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt={contact.name ?? ""} />}
              <AvatarFallback className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 ring-2 ring-background rounded-md">
              <ProviderBadge provider={conversation.channel.provider as CrmChannelProvider} size="xs" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{contact.name ?? (contact.instagram_username ? `@${contact.instagram_username}` : "Sin nombre")}</h3>
              {conversation.tags.slice(0, 2).map((t) => (
                <TagChip key={t.id} tag={t} size="xs" />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {contact.external_kind === "phone"
                ? formatPhoneForDisplay(contact.phone)
                : contact.instagram_username
                ? `@${contact.instagram_username} · IGSID ${contact.external_id.slice(0, 10)}…`
                : `IGSID ${contact.external_id.slice(0, 10)}…`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SessionTimer lastCustomerMessageAt={conversation.last_customer_message_at} />
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Snooze">
                <Moon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="end">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1 font-semibold">
                Pausar por...
              </div>
              {[
                { label: "1 hora", h: 1 },
                { label: "4 horas", h: 4 },
                { label: "Hasta mañana 9am", h: hoursUntilTomorrow9am() },
                { label: "1 día", h: 24 },
                { label: "1 semana", h: 168 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => handleSnooze(opt.h)}
                  className="w-full text-left px-2 py-1.5 hover:bg-muted rounded text-sm"
                >
                  {opt.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Archivar" onClick={handleArchive}>
            <Archive className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Sugerencias IA">
            <Sparkles className="size-4" />
          </Button>
          <Button
            size="sm"
            variant={contextPanelOpen ? "secondary" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={onContextToggle}
            title="Información"
          >
            <Info className="size-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef as unknown as React.RefObject<HTMLDivElement>}>
        <div className="p-4 space-y-2">
          {messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Sin mensajes en este thread.
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>
      </ScrollArea>

      {/* Composer / closed banner */}
      {isClosed ? (
        <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/30">
          <span className="text-sm text-muted-foreground">Conversación cerrada</span>
          <Button size="sm" variant="outline" onClick={handleReopen} disabled={isPending}>
            <RotateCcw className="size-3.5 mr-1.5" /> Reabrir
          </Button>
        </div>
      ) : sessionExpired ? (
        <div className="border-t border-border px-4 py-3 bg-amber-500/10 border-amber-500/20">
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
            Pasaron más de 24h del último mensaje del cliente — solo podés enviar templates aprobados.
          </p>
          <Button size="sm" variant="outline">Elegir template</Button>
        </div>
      ) : (
        <ComposerWithSlash
          draft={draft}
          setDraft={setDraft}
          contact={contact}
          isPending={isPending}
          onSend={handleSend}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

function hoursUntilTomorrow9am(): number {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 3_600_000));
}

interface ComposerProps {
  draft: string;
  setDraft: (v: string) => void;
  contact: CrmContactWithLinks;
  isPending: boolean;
  onSend: () => void;
  onClose: () => void;
}

function ComposerWithSlash({ draft, setDraft, contact, isPending, onSend, onClose }: ComposerProps) {
  // Detectar si el draft empieza con "/" para activar el picker de rápidos.
  const slashMatch = useMemo(() => {
    const m = draft.match(/^\/(\S*)$/);
    return m ? m[1] : null;
  }, [draft]);

  return (
    <div className="border-t border-border p-3 relative">
      {slashMatch !== null && (
        <QuickReplyPicker
          query={slashMatch}
          contact={contact}
          onSelect={(text) => setDraft(text)}
          onClose={() => setDraft("")}
        />
      )}
      <div className="flex items-end gap-2">
        <Button size="sm" variant="ghost" className="h-9 w-9 p-0 shrink-0">
          <Paperclip className="size-4" />
        </Button>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && slashMatch === null) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Escribí un mensaje · /rápidos · Enter envía, Shift+Enter nueva línea"
          className="min-h-9 max-h-32 resize-none flex-1 text-sm"
          rows={1}
          disabled={isPending}
        />
        <Button
          size="sm"
          onClick={onSend}
          disabled={!draft.trim() || isPending}
          className="bg-emerald-500 hover:bg-emerald-600 text-white h-9 shrink-0"
        >
          <Send className="size-4" />
        </Button>
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
        <span>Tipear <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">/</kbd> para usar un rápido</span>
        <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground" onClick={onClose}>
          Cerrar conversación
        </Button>
      </div>
    </div>
  );
}
