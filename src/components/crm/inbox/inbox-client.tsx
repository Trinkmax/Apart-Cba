"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Inbox as InboxIcon, ArchiveX, Filter, X, Archive, MessageCircleOff, Tag as TagIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { TagChip } from "@/components/crm/shared/tag-chip";
import { ProviderBadge } from "@/components/crm/shared/provider-badge";
import { ConversationListItem } from "./conversation-list-item";
import { ChatPane } from "./chat-pane";
import { ContextPanel } from "./context-panel";
import { useInboxRealtime } from "./hooks/use-inbox-realtime";
import { cn } from "@/lib/utils";
import { bulkCloseConversations, bulkArchiveConversations, bulkTagConversations } from "@/lib/actions/crm-conversations";
import type { CrmChannel, CrmConversationListItem, CrmTag } from "@/lib/types/database";

interface Props {
  initialConversations: CrmConversationListItem[];
  tags: CrmTag[];
  channels: CrmChannel[];
}

type StatusFilter = "all" | "open" | "closed" | "assigned_to_me";

export function InboxClient({ initialConversations, tags, channels }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = searchParams.get("c");

  const [conversations, setConversations] = useState<CrmConversationListItem[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? initialConversations[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeTagSlugs, setActiveTagSlugs] = useState<string[]>([]);
  const [activeChannelIds, setActiveChannelIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showContextPanel, setShowContextPanel] = useState(true);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // Realtime suscripción a cambios
  useInboxRealtime((event) => {
    if (event.kind === "conv_change") {
      // Refresh conversation in place
      const row = event.row as unknown as Partial<CrmConversationListItem>;
      const rowId = row.id as string | undefined;
      if (!rowId) return;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === rowId);
        if (idx === -1) return prev;
        const updated = [...prev];
        const existing = updated[idx];
        updated[idx] = { ...existing, ...row } as CrmConversationListItem;
        return updated.sort((a, b) =>
          (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")
        );
      });
    }
    if (event.kind === "message_insert") {
      // Re-fetch via router refresh para sincronizar todo
      startTransition(() => router.refresh());
    }
  });

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (statusFilter === "open" && c.status !== "open") return false;
      if (statusFilter === "closed" && c.status !== "closed") return false;
      if (activeTagSlugs.length > 0 && !c.tags.some((t) => activeTagSlugs.includes(t.slug))) return false;
      if (activeChannelIds.length > 0 && !activeChannelIds.includes(c.channel_id)) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          c.contact.name?.toLowerCase().includes(q) ||
          c.contact.phone?.includes(q) ||
          c.contact.instagram_username?.toLowerCase().includes(q) ||
          c.contact.external_id.toLowerCase().includes(q) ||
          c.last_message_preview?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [conversations, statusFilter, activeTagSlugs, activeChannelIds, search]);

  const totalUnread = filteredConversations.reduce((sum, c) => sum + c.unread_count, 0);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("c", id);
    router.replace(`/dashboard/crm/inbox?${params.toString()}`);
  };

  const toggleTag = (slug: string) => {
    setActiveTagSlugs((prev) => prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]);
  };

  const toggleChannel = (id: string) => {
    setActiveChannelIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setBulkMode(false);
  };

  const handleBulkClose = () => {
    if (!confirm(`¿Cerrar ${selected.size} conversaciones?`)) return;
    startTransition(async () => {
      await bulkCloseConversations(Array.from(selected));
      toast.success(`${selected.size} cerradas`);
      clearSelection();
      router.refresh();
    });
  };

  const handleBulkArchive = () => {
    startTransition(async () => {
      await bulkArchiveConversations(Array.from(selected));
      toast.success(`${selected.size} archivadas`);
      clearSelection();
      router.refresh();
    });
  };

  const handleBulkTag = (tagId: string) => {
    startTransition(async () => {
      await bulkTagConversations(Array.from(selected), tagId);
      toast.success(`Tag aplicada a ${selected.size}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0 bg-background">
      {/* Top tag filter bar */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <Button
          size="sm"
          variant={activeTagSlugs.length === 0 ? "default" : "outline"}
          onClick={() => setActiveTagSlugs([])}
          className="rounded-full text-xs h-7 shrink-0"
        >
          Todas
        </Button>
        {tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => toggleTag(tag.slug)}
            className="shrink-0"
          >
            <TagChip tag={tag} size="sm" selected={activeTagSlugs.includes(tag.slug)} />
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: conversation list */}
        <aside className="w-[320px] shrink-0 border-r border-border flex flex-col min-h-0">
          <div className="p-3 border-b border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <InboxIcon className="size-4" /> Mensajería
                {totalUnread > 0 && (
                  <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{totalUnread}</span>
                )}
              </h2>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <Filter className="size-4" />
              </Button>
            </div>

            {/* Channel chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
              <button
                onClick={() => setActiveChannelIds([])}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium transition-colors shrink-0",
                  activeChannelIds.length === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                Todos
              </button>
              {channels.map((ch) => {
                const isActive = activeChannelIds.includes(ch.id);
                const isIG = ch.provider === "meta_instagram";
                return (
                  <button
                    key={ch.id}
                    onClick={() => toggleChannel(ch.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors shrink-0 inline-flex items-center gap-1.5",
                      isActive
                        ? isIG
                          ? "text-white"
                          : "bg-emerald-500 text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                    style={isActive && isIG ? { background: "linear-gradient(135deg, #fdcc80 0%, #e1306c 50%, #833ab4 100%)" } : undefined}
                  >
                    <ProviderBadge provider={ch.provider} size="xs" />
                    {ch.display_name}
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar o iniciar chat"
                className="pl-8 h-8 text-sm"
              />
            </div>

            {/* Status quick filters */}
            <div className="flex items-center gap-1">
              {(["all", "open", "closed", "assigned_to_me"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-2 py-1 text-xs rounded-md font-medium",
                    statusFilter === s ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "all" ? "Todas" : s === "open" ? "Abiertas" : s === "closed" ? "Cerradas" : "Mías"}
                </button>
              ))}
            </div>
          </div>

          {/* Bulk action bar */}
          {bulkMode && (
            <div className="border-b border-border bg-emerald-500/5 px-3 py-2 flex items-center gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={clearSelection}>
                <X className="size-3.5" />
              </Button>
              <span className="text-xs font-medium">{selected.size} seleccionada{selected.size !== 1 ? "s" : ""}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={selected.size === 0} onClick={handleBulkClose}>
                  <MessageCircleOff className="size-3 mr-1" /> Cerrar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={selected.size === 0} onClick={handleBulkArchive}>
                  <Archive className="size-3 mr-1" /> Archivar
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={selected.size === 0}>
                      <TagIcon className="size-3 mr-1" /> Tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-60 p-2" align="end">
                    <div className="text-xs font-medium mb-2">Aplicar tag a {selected.size}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <button key={t.id} onClick={() => handleBulkTag(t.id)}>
                          <TagChip tag={t} size="xs" />
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
          {!bulkMode && filteredConversations.length > 0 && (
            <button
              onClick={() => setBulkMode(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-3 py-1 border-b border-border text-left"
            >
              ☐ Selección múltiple
            </button>
          )}

          <ScrollArea className="flex-1">
            {filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <ArchiveX className="size-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Sin conversaciones que coincidan</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredConversations.map((conv) => (
                  <div key={conv.id} className="flex items-stretch">
                    {bulkMode && (
                      <div className="flex items-center pl-3">
                        <Checkbox
                          checked={selected.has(conv.id)}
                          onCheckedChange={() => toggleSelected(conv.id)}
                          aria-label={`Seleccionar ${conv.contact.name ?? conv.contact.phone}`}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <ConversationListItem
                        conversation={conv}
                        isSelected={!bulkMode && conv.id === selectedId}
                        onClick={() => bulkMode ? toggleSelected(conv.id) : handleSelect(conv.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Center: chat */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {selectedId ? (
            <ChatPane
              key={selectedId}
              conversationId={selectedId}
              tags={tags}
              onContextToggle={() => setShowContextPanel((v) => !v)}
              contextPanelOpen={showContextPanel}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <InboxIcon className="size-12 mx-auto mb-3 opacity-30" />
                <p>Seleccioná una conversación</p>
              </div>
            </div>
          )}
        </main>

        {/* Right: context panel */}
        {showContextPanel && selectedId && (
          <ContextPanel key={selectedId} conversationId={selectedId} tags={tags} />
        )}
      </div>
    </div>
  );
}
