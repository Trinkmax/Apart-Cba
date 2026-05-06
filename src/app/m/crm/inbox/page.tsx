import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MessageSquareText, MessageCircleOff } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { listConversations } from "@/lib/actions/crm-conversations";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

export const dynamic = "force-dynamic";

export default async function MobileCrmInboxPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "view")) redirect("/sin-acceso");

  const conversations = await listConversations({ status: "all", limit: 100 });

  return (
    <div className="px-4 pt-4 pb-2">
      <header className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquareText className="size-5" /> Inbox
        </h1>
        <p className="text-xs text-muted-foreground">{conversations.length} conversaciones</p>
      </header>

      {conversations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquareText className="size-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin conversaciones</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {conversations.map((conv) => {
            const label = conv.contact.name ?? conv.contact.instagram_username ?? conv.contact.phone ?? conv.contact.external_id ?? "?";
            const initials = label
              .split(/\s+/)
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase() || "?";
            const isClosed = conv.status === "closed";
            const timeAgo = conv.last_message_at
              ? formatDistanceToNowStrict(new Date(conv.last_message_at), { locale: es, addSuffix: false })
              : "—";
            return (
              <Link
                key={conv.id}
                href={`/m/crm/inbox/${conv.id}`}
                className="flex items-center gap-3 py-3 active:bg-accent transition-colors tap"
              >
                <Avatar className="size-11 shrink-0">
                  <AvatarFallback className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-medium text-[15px] truncate">{conv.contact.name ?? (conv.contact.instagram_username ? `@${conv.contact.instagram_username}` : conv.contact.phone) ?? "?"}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isClosed && <MessageCircleOff className="size-3 text-muted-foreground shrink-0" />}
                    <p className="text-xs text-muted-foreground line-clamp-1">{conv.last_message_preview ?? "Sin mensajes"}</p>
                  </div>
                  {conv.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {conv.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} size="xs" />)}
                      {conv.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{conv.tags.length - 2}</span>}
                    </div>
                  )}
                </div>
                {conv.unread_count > 0 && (
                  <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{conv.unread_count}</span>
                )}
                <ChevronRight className="size-4 text-muted-foreground shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
