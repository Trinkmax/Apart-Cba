"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Search, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getConversation,
  listConversations,
  markConversationAsRead,
  searchGuestsForMessaging,
  findOrCreateConversation,
} from "@/lib/actions/messaging";
import type {
  MessagingChannel,
  MessagingChannelType,
  MessagingConversationStatus,
  MessagingMessage,
  MessagingTag,
  MessagingTemplate,
} from "@/lib/types/database";
import { ConversationList } from "./conversation-list";
import { ConversationThread } from "./conversation-thread";
import { ConversationInfoPanel } from "./conversation-info-panel";
import { NewConversationDialog } from "./new-conversation-dialog";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import { toast } from "sonner";
import type { ConversationListItem } from "./messaging-shell";

type ChannelTab = "all" | MessagingChannelType;

interface ConversationDetail {
  conversation: ConversationListItem & {
    contact: ConversationListItem["contact"] & {
      guest: {
        id: string;
        full_name: string;
        phone: string | null;
        email: string | null;
        country: string | null;
        total_bookings: number;
      } | null;
    };
    channel: { id: string; channel_type: MessagingChannelType; display_name: string | null; status: string };
    related_booking: {
      id: string;
      check_in_date: string;
      check_out_date: string;
      status: string;
      unit: { id: string; code: string; name: string } | null;
    } | null;
  };
  messages: MessagingMessage[];
}

interface Props {
  initialConversations: ConversationListItem[];
  tags: MessagingTag[];
  templates: MessagingTemplate[];
  channels: MessagingChannel[];
  statusFilter: MessagingConversationStatus | "all";
  tagFilter: string | null;
  onClearFilters: () => void;
  onConfigure: () => void;
}

export function MessagingInbox({
  initialConversations,
  tags,
  templates,
  channels,
  statusFilter,
  tagFilter,
  onClearFilters,
  onConfigure,
}: Props) {
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    initialConversations
  );
  const [channelTab, setChannelTab] = useState<ChannelTab>("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, startLoadingDetail] = useTransition();
  const [newConvOpen, setNewConvOpen] = useState(false);

  // re-load conversations cuando cambian los filtros server-side
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listConversations({
          channelType: channelTab,
          status: statusFilter,
          tagId: tagFilter ?? undefined,
          search: search.trim() || undefined,
        });
        if (!cancelled) setConversations(list);
      } catch (e) {
        if (!cancelled)
          toast.error(e instanceof Error ? e.message : "Error al cargar conversaciones");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelTab, statusFilter, tagFilter, search]);

  const filteredConversations = useMemo(() => conversations, [conversations]);

  const tabCounts = useMemo(() => {
    return {
      all: conversations.length,
      whatsapp: conversations.filter((c) => c.contact.channel_type === "whatsapp").length,
      instagram: conversations.filter((c) => c.contact.channel_type === "instagram").length,
    };
  }, [conversations]);

  // Carga detalle al cambiar de conversación
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    startLoadingDetail(async () => {
      try {
        const r = await getConversation(activeId);
        if (r) {
          setDetail(r as never);
          if (r.conversation.unread_count > 0) {
            await markConversationAsRead(activeId);
            setConversations((prev) =>
              prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c))
            );
          }
        } else {
          setDetail(null);
          toast.error("No se encontró la conversación");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al cargar la conversación");
      }
    });
  }, [activeId]);

  // Empuja un mensaje recién enviado al estado local (sin re-fetch)
  const handleMessageSent = (msg: MessagingMessage) => {
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, msg] } : prev));
    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === msg.conversation_id
            ? {
                ...c,
                last_message_at: msg.sent_at,
                last_message_preview: msg.text ?? c.last_message_preview,
                last_message_direction: msg.direction,
              }
            : c
        )
        .sort((a, b) => {
          const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return tb - ta;
        })
    );
  };

  const isFresh = channels.length === 0;

  // ─── Onboarding cuando no hay nada conectado ───────────────────────────
  if (isFresh) {
    return (
      <div className="flex-1 grid place-items-center p-8">
        <div className="max-w-md text-center space-y-5">
          <div className="size-16 mx-auto rounded-2xl brand-gradient grid place-items-center shadow-lg">
            <MessageCircle className="size-7 text-white" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">Conectá tus canales</h2>
            <p className="text-sm text-muted-foreground">
              Vinculá tu número de WhatsApp Business y tu cuenta de Instagram para responder
              huéspedes desde un único inbox, vincular conversaciones a reservas y disparar
              automatizaciones por estadía.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <div className="size-7 rounded-md border border-emerald-500/30 bg-emerald-500/10 grid place-items-center">
              <WhatsAppIcon className="size-4" />
            </div>
            <div className="size-7 rounded-md border border-pink-500/30 bg-pink-500/10 grid place-items-center">
              <InstagramIcon className="size-4" />
            </div>
          </div>
          <Button onClick={onConfigure} size="lg" className="gap-2">
            Conectar canales
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden">
      {/* ─── Lista de conversaciones ──────────────────────────────────────── */}
      <aside className="w-[340px] flex-shrink-0 border-r border-border flex flex-col bg-card/30">
        <div className="flex-shrink-0 border-b border-border p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Conversaciones</h2>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setNewConvOpen(true)}
              title="Nueva conversación"
            >
              <Plus size={15} />
            </Button>
          </div>

          {/* Tabs Todos/WA/IG */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-muted/50 rounded-lg">
            <ChannelTabButton
              label="Todos"
              active={channelTab === "all"}
              count={tabCounts.all}
              onClick={() => setChannelTab("all")}
            />
            <ChannelTabButton
              label="WhatsApp"
              active={channelTab === "whatsapp"}
              count={tabCounts.whatsapp}
              icon={<WhatsAppIcon className="size-3.5" />}
              onClick={() => setChannelTab("whatsapp")}
            />
            <ChannelTabButton
              label="Instagram"
              active={channelTab === "instagram"}
              count={tabCounts.instagram}
              icon={<InstagramIcon className="size-3.5" />}
              onClick={() => setChannelTab("instagram")}
            />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por nombre o número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>

          {(statusFilter !== "all" || tagFilter) && (
            <button
              type="button"
              onClick={onClearFilters}
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              ✕ Quitar filtros
            </button>
          )}
        </div>

        <ConversationList
          conversations={filteredConversations}
          activeId={activeId}
          onSelect={(id) => setActiveId(id)}
          tags={tags}
        />
      </aside>

      {/* ─── Hilo + composer ─────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!activeId && (
          <EmptyChat onNewConversation={() => setNewConvOpen(true)} />
        )}
        {activeId && (
          <ConversationThread
            key={activeId}
            loading={loadingDetail}
            detail={detail}
            templates={templates}
            tags={tags}
            onMessageSent={handleMessageSent}
            onConversationUpdate={(updates) => {
              setConversations((prev) =>
                prev.map((c) => (c.id === activeId ? { ...c, ...updates } : c))
              );
              setDetail((prev) =>
                prev
                  ? {
                      ...prev,
                      conversation: { ...prev.conversation, ...updates },
                    }
                  : prev
              );
            }}
          />
        )}
      </section>

      {/* ─── Panel derecho info ──────────────────────────────────────────── */}
      {activeId && detail && (
        <ConversationInfoPanel
          detail={detail}
          tags={tags}
          onConversationUpdate={(updates) => {
            setConversations((prev) =>
              prev.map((c) => (c.id === activeId ? { ...c, ...updates } : c))
            );
            setDetail((prev) =>
              prev
                ? {
                    ...prev,
                    conversation: { ...prev.conversation, ...updates },
                  }
                : prev
            );
          }}
        />
      )}

      <NewConversationDialog
        open={newConvOpen}
        onOpenChange={setNewConvOpen}
        channels={channels}
        onSearchGuests={searchGuestsForMessaging}
        onCreate={async (input) => {
          const r = await findOrCreateConversation(input);
          // Refrescar lista y abrir esa conversación
          const list = await listConversations();
          setConversations(list);
          setActiveId(r.conversationId);
          setNewConvOpen(false);
        }}
      />
    </div>
  );
}

// Re-export menores para que el thread los use sin import extra
export type { MessagingTemplate, MessagingTag };

function ChannelTabButton({
  label,
  active,
  count,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="text-[10px] tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

function EmptyChat({ onNewConversation }: { onNewConversation: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-8 bg-gradient-to-br from-background via-background to-muted/30">
      <div className="text-center max-w-sm space-y-4">
        <div className="size-16 mx-auto rounded-2xl bg-muted/60 grid place-items-center">
          <MessageCircle className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold">Seleccioná una conversación</h3>
          <p className="text-sm text-muted-foreground">
            Elegí un hilo de la izquierda para responder, o iniciá una nueva conversación con
            un huésped existente.
          </p>
        </div>
        <Button variant="outline" onClick={onNewConversation} className="gap-2">
          <Plus size={15} />
          Nueva conversación
        </Button>
      </div>
    </div>
  );
}

