"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { ProviderBadge } from "@/components/crm/shared/provider-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageCircleOff } from "lucide-react";
import type { CrmChannelProvider, CrmConversationListItem } from "@/lib/types/database";

interface Props {
  conversation: CrmConversationListItem;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationListItem({ conversation, isSelected, onClick }: Props) {
  const labelForInitials = conversation.contact.name
    ?? conversation.contact.instagram_username
    ?? conversation.contact.phone
    ?? conversation.contact.external_id;
  const initials = (labelForInitials ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  const isClosed = conversation.status === "closed";
  const timeAgo = conversation.last_message_at
    ? formatDistanceToNowStrict(new Date(conversation.last_message_at), { locale: es, addSuffix: false })
    : "—";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 hover:bg-muted/50 transition-colors block",
        isSelected && "bg-muted",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="size-10">
            {conversation.contact.avatar_url && (
              <AvatarImage src={conversation.contact.avatar_url} alt={conversation.contact.name ?? ""} />
            )}
            <AvatarFallback className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background rounded-md">
            <ProviderBadge provider={conversation.channel.provider as CrmChannelProvider} size="xs" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="font-medium text-sm truncate">
              {conversation.contact.name ?? (conversation.contact.instagram_username ? `@${conversation.contact.instagram_username}` : conversation.contact.phone) ?? "Sin nombre"}
            </span>
            {isClosed && (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground line-through shrink-0 inline-flex items-center gap-0.5">
                <MessageCircleOff className="size-2.5" /> Cerrada
              </span>
            )}
            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo}</span>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5">
            {conversation.last_message_preview ?? "Sin mensajes"}
          </p>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              {conversation.tags.slice(0, 3).map((tag) => (
                <TagChip key={tag.id} tag={tag} size="xs" />
              ))}
              {conversation.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{conversation.tags.length - 3}</span>
              )}
            </div>
            {conversation.unread_count > 0 && (
              <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shrink-0">
                {conversation.unread_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
