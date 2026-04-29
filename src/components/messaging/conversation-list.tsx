"use client";

import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo, getInitials } from "@/lib/format";
import { WhatsAppIcon, InstagramIcon } from "./channel-icons";
import type { ConversationListItem } from "./messaging-shell";
import type { MessagingTag } from "@/lib/types/database";

interface Props {
  conversations: ConversationListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  tags: MessagingTag[];
}

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-amber-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-orange-500",
  "bg-teal-500",
];

function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function ConversationList({ conversations, activeId, onSelect, tags }: Props) {
  if (conversations.length === 0) {
    return (
      <div className="flex-1 grid place-items-center p-8 text-center">
        <div>
          <Inbox className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Sin conversaciones</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Cuando lleguen mensajes los vas a ver aquí
          </p>
        </div>
      </div>
    );
  }

  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return (
    <ul className="flex-1 overflow-y-auto" role="listbox">
      {conversations.map((c) => {
        const isActive = c.id === activeId;
        const name = c.contact.display_name?.trim() || c.contact.external_id;
        const isUnread = c.unread_count > 0;
        const ChannelIcon = c.contact.channel_type === "whatsapp" ? WhatsAppIcon : InstagramIcon;
        return (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => onSelect(c.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 border-l-2 border-transparent transition-colors flex gap-3 items-start",
                "hover:bg-muted/60",
                isActive
                  ? "bg-primary/5 border-l-primary"
                  : isUnread
                  ? "bg-card"
                  : ""
              )}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "size-10 rounded-full grid place-items-center text-white text-xs font-semibold shadow-sm",
                    colorForName(name)
                  )}
                >
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

              {/* Texto */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className={cn(
                      "text-sm leading-tight truncate",
                      isUnread ? "font-semibold" : "font-medium"
                    )}
                  >
                    {name}
                  </h3>
                  <span
                    className={cn(
                      "text-[10px] shrink-0 tabular-nums",
                      isUnread ? "text-primary font-semibold" : "text-muted-foreground"
                    )}
                  >
                    {c.last_message_at ? formatTimeAgo(c.last_message_at).replace("hace ", "") : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p
                    className={cn(
                      "text-xs leading-tight truncate",
                      isUnread ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {c.last_message_direction === "outbound" && (
                      <span className="text-muted-foreground/70 mr-1">Tú:</span>
                    )}
                    {c.last_message_preview ?? "—"}
                  </p>
                  {isUnread && (
                    <span className="shrink-0 size-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums grid place-items-center">
                      {c.unread_count > 99 ? "99+" : c.unread_count}
                    </span>
                  )}
                </div>
                {c.tag_ids.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {c.tag_ids.slice(0, 3).map((id) => {
                      const t = tagMap.get(id);
                      if (!t) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium"
                          style={{
                            backgroundColor: `${t.color}1A`,
                            color: t.color,
                          }}
                        >
                          <span className="size-1 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
