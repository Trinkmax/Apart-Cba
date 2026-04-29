"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCheck,
  Check,
  Clock,
  AlertTriangle,
  MoreVertical,
  Archive,
  X,
  BellOff,
  CornerUpRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimeAgo, getInitials } from "@/lib/format";
import {
  setConversationStatus,
  sendMessage,
} from "@/lib/actions/messaging";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import { Composer } from "./composer";
import { toast } from "sonner";
import type {
  MessagingConversation,
  MessagingMessage,
  MessagingTag,
  MessagingTemplate,
} from "@/lib/types/database";
import type { ConversationListItem } from "./messaging-shell";

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
    channel: { id: string; channel_type: "whatsapp" | "instagram"; display_name: string | null; status: string };
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
  loading: boolean;
  detail: ConversationDetail | null;
  templates: MessagingTemplate[];
  tags: MessagingTag[];
  onMessageSent: (msg: MessagingMessage) => void;
  onConversationUpdate: (updates: Partial<MessagingConversation>) => void;
}

export function ConversationThread({
  loading,
  detail,
  templates,
  onMessageSent,
  onConversationUpdate,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();

  // Auto-scroll cuando llegan/se envían mensajes
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.messages.length]);

  if (loading || !detail) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { conversation, messages } = detail;
  const c = conversation;
  const name = c.contact.display_name?.trim() || c.contact.external_id;
  const ChannelIcon = c.contact.channel_type === "whatsapp" ? WhatsAppIcon : InstagramIcon;
  const isClosed = c.status === "closed" || c.status === "archived";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gradient-to-b from-background to-background/50">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border bg-card/50 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="size-10 rounded-full bg-muted grid place-items-center text-foreground/80 text-xs font-semibold">
            {c.contact.profile_pic_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.contact.profile_pic_url}
                alt={name}
                className="size-full rounded-full object-cover"
              />
            ) : (
              getInitials(name)
            )}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-card bg-card grid place-items-center">
            <ChannelIcon className="size-3" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate">{name}</h2>
            {c.contact.guest && (
              <span className="text-[10px] uppercase tracking-wide font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                Huésped
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {c.contact.channel_type === "whatsapp" ? "+" : "@"}
            {c.contact.external_id}
            {c.last_message_at && (
              <>
                <span className="mx-1.5">·</span>
                Última: {formatTimeAgo(c.last_message_at)}
              </>
            )}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8">
              <MoreVertical size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!isClosed ? (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    startTransition(async () => {
                      await setConversationStatus(c.id, "snoozed");
                      onConversationUpdate({ status: "snoozed" });
                      toast.success("Conversación silenciada");
                    });
                  }}
                >
                  <BellOff size={14} className="mr-2" /> Silenciar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    startTransition(async () => {
                      await setConversationStatus(c.id, "closed");
                      onConversationUpdate({ status: "closed" });
                      toast.success("Conversación cerrada");
                    });
                  }}
                >
                  <X size={14} className="mr-2" /> Cerrar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    startTransition(async () => {
                      await setConversationStatus(c.id, "archived");
                      onConversationUpdate({ status: "archived" });
                      toast.success("Archivado");
                    });
                  }}
                >
                  <Archive size={14} className="mr-2" /> Archivar
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  startTransition(async () => {
                    await setConversationStatus(c.id, "open");
                    onConversationUpdate({ status: "open" });
                    toast.success("Reabierta");
                  });
                }}
              >
                <CornerUpRight size={14} className="mr-2" /> Reabrir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-2">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">
            Sin mensajes todavía
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showTime =
              !prev ||
              new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() > 1000 * 60 * 30;
            return (
              <div key={m.id}>
                {showTime && (
                  <div className="text-center my-3">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 bg-muted/60 px-2 py-1 rounded">
                      {formatTimeAgo(m.sent_at)}
                    </span>
                  </div>
                )}
                <MessageBubble message={m} />
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <Composer
        templates={templates}
        disabled={isClosed || isPending}
        disabledReason={
          isClosed
            ? "Esta conversación está cerrada. Reabrila desde el menú para responder."
            : undefined
        }
        onSend={async (input) => {
          try {
            const msg = await sendMessage({
              conversation_id: c.id,
              text: input.text,
              content_type: "text",
            });
            onMessageSent(msg);
            if (msg.status === "failed") {
              toast.error(`Falló el envío: ${msg.error_message ?? "Error desconocido"}`);
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error al enviar");
          }
        }}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: MessagingMessage }) {
  const isOutbound = message.direction === "outbound";
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm relative",
          isOutbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-card border border-border text-foreground rounded-bl-sm"
        )}
      >
        {message.media_url && (
          <div className="mb-1.5 -mx-1 -mt-1">
            {message.content_type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.media_url}
                alt={message.media_caption ?? "imagen"}
                className="rounded-xl max-h-72 w-auto"
              />
            ) : message.content_type === "video" ? (
              <video
                src={message.media_url}
                controls
                className="rounded-xl max-h-72 w-auto"
              />
            ) : message.content_type === "audio" ? (
              <audio src={message.media_url} controls className="w-full" />
            ) : (
              <a
                href={message.media_url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "block rounded-lg px-3 py-2 text-xs font-medium",
                  isOutbound
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                📄 {message.media_filename ?? "Archivo adjunto"}
              </a>
            )}
          </div>
        )}
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        <div
          className={cn(
            "flex items-center gap-1 justify-end mt-1 text-[10px]",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span className="tabular-nums">
            {new Date(message.sent_at).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isOutbound && <MessageStatus status={message.status} />}
        </div>
      </div>
    </div>
  );
}

function MessageStatus({ status }: { status: MessagingMessage["status"] }) {
  if (status === "queued") return <Clock size={12} aria-label="Encolado" />;
  if (status === "sent") return <Check size={12} aria-label="Enviado" />;
  if (status === "delivered") return <CheckCheck size={12} aria-label="Entregado" />;
  if (status === "read")
    return (
      <CheckCheck size={12} className="text-blue-300" aria-label="Leído" />
    );
  if (status === "failed")
    return (
      <AlertTriangle size={12} className="text-red-400" aria-label="Falló" />
    );
  return null;
}
