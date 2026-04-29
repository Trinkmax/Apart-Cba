"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Inbox,
  Megaphone,
  Workflow,
  BellRing,
  MessageSquareText,
  Settings,
  Sparkles,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { seedMessagingDefaults } from "@/lib/actions/messaging";
import type {
  MessagingAlert,
  MessagingBroadcast,
  MessagingChannel,
  MessagingContact,
  MessagingConversation,
  MessagingConversationStatus,
  MessagingChannelType,
  MessagingTag,
  MessagingTemplate,
  MessagingWorkflow,
} from "@/lib/types/database";
import { MessagingInbox } from "./messaging-inbox";
import { MessagingBroadcasts } from "./messaging-broadcasts";
import { MessagingWorkflows } from "./messaging-workflows";
import { MessagingAlerts } from "./messaging-alerts";
import { MessagingQuickReplies } from "./messaging-quick-replies";
import { MessagingSettingsDialog } from "./messaging-settings-dialog";
import { ChannelStatusPill } from "./channel-status-pill";
import { toast } from "sonner";

export type ConversationListItem = MessagingConversation & {
  contact: MessagingContact;
  channel: { channel_type: MessagingChannelType; display_name: string | null };
};

export type AlertListItem = MessagingAlert & {
  conversation: {
    id: string;
    contact: Pick<MessagingContact, "display_name" | "external_id" | "channel_type">;
  } | null;
};

type Tab = "inbox" | "broadcasts" | "workflows" | "alerts" | "templates";

interface Props {
  initialStats: {
    unreadCount: number;
    openCount: number;
    pendingAlerts: number;
    scheduledBroadcasts: number;
    channels: { whatsapp: boolean; instagram: boolean };
  };
  initialChannels: MessagingChannel[];
  initialConversations: ConversationListItem[];
  initialTags: MessagingTag[];
  initialTemplates: MessagingTemplate[];
  initialWorkflows: MessagingWorkflow[];
  initialBroadcasts: MessagingBroadcast[];
  initialAlerts: AlertListItem[];
}

export function MessagingShell(props: Props) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<MessagingConversationStatus | "all">("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [seedPending, startSeed] = useTransition();

  const totalCounts = useMemo(
    () => ({
      inbox: props.initialStats.unreadCount,
      broadcasts: props.initialStats.scheduledBroadcasts,
      workflows: props.initialWorkflows.filter((w) => w.active).length,
      alerts: props.initialStats.pendingAlerts,
      templates: props.initialTemplates.filter((t) => t.active).length,
    }),
    [
      props.initialStats.unreadCount,
      props.initialStats.scheduledBroadcasts,
      props.initialStats.pendingAlerts,
      props.initialWorkflows,
      props.initialTemplates,
    ]
  );

  const isFresh =
    props.initialChannels.length === 0 &&
    props.initialTags.length === 0 &&
    props.initialTemplates.length === 0;

  return (
    <div className="flex flex-col w-full h-[calc(100dvh-4rem)] bg-background overflow-hidden">
      {/* ─── Header global ────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-xl brand-gradient grid place-items-center shadow-sm">
              <MessageSquareText className="size-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight leading-tight">Mensajería</h1>
              <p className="text-xs text-muted-foreground leading-tight">
                Conversaciones unificadas con tus huéspedes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ChannelStatusPill
              type="whatsapp"
              connected={props.initialStats.channels.whatsapp}
              onClick={() => setSettingsOpen(true)}
            />
            <ChannelStatusPill
              type="instagram"
              connected={props.initialStats.channels.instagram}
              onClick={() => setSettingsOpen(true)}
            />
            <div className="w-px h-6 bg-border mx-1" />
            {isFresh && (
              <Button
                size="sm"
                variant="outline"
                disabled={seedPending}
                onClick={() => {
                  startSeed(async () => {
                    try {
                      const r = await seedMessagingDefaults();
                      toast.success(`Listo: se crearon ${r.created} elementos por defecto`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Error al inicializar");
                    }
                  });
                }}
                className="gap-1.5"
              >
                <Sparkles size={14} /> Cargar defaults
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              className="gap-1.5"
            >
              <Settings size={15} />
              <span className="hidden sm:inline">Configuración</span>
            </Button>
          </div>
        </div>

        {/* Segunda fila: tag pills (solo en inbox) */}
        {tab === "inbox" && props.initialTags.length > 0 && (
          <div className="px-6 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-thin">
            <button
              type="button"
              onClick={() => {
                setTagFilter(null);
                setStatusFilter("all");
              }}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                !tagFilter && statusFilter === "all"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Todas
              <span className="text-[10px] tabular-nums opacity-70">
                {props.initialConversations.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("open");
                setTagFilter(null);
              }}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === "open"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Abiertas
              <span className="text-[10px] tabular-nums opacity-70">
                {props.initialStats.openCount}
              </span>
            </button>
            {props.initialTags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTagFilter(tagFilter === t.id ? null : t.id);
                  setStatusFilter("all");
                }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border",
                  tagFilter === t.id
                    ? "text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                style={
                  tagFilter === t.id
                    ? {
                        backgroundColor: `${t.color}1A`,
                        borderColor: `${t.color}55`,
                      }
                    : undefined
                }
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ─── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Rail vertical */}
        <nav className="flex-shrink-0 w-[68px] border-r border-border bg-card/30 flex flex-col">
          <div className="flex-1 flex flex-col gap-1 p-2">
            <RailButton
              icon={Inbox}
              label="Inbox"
              active={tab === "inbox"}
              onClick={() => setTab("inbox")}
              badge={totalCounts.inbox || undefined}
            />
            <RailButton
              icon={Megaphone}
              label="Difusiones"
              active={tab === "broadcasts"}
              onClick={() => setTab("broadcasts")}
              badge={totalCounts.broadcasts || undefined}
            />
            <RailButton
              icon={Workflow}
              label="Workflows"
              active={tab === "workflows"}
              onClick={() => setTab("workflows")}
              badge={totalCounts.workflows || undefined}
            />
            <RailButton
              icon={BellRing}
              label="Alertas"
              active={tab === "alerts"}
              onClick={() => setTab("alerts")}
              badge={totalCounts.alerts || undefined}
              badgeColor="urgent"
            />
            <RailButton
              icon={MessageSquareText}
              label="Rápidos"
              active={tab === "templates"}
              onClick={() => setTab("templates")}
              badge={totalCounts.templates || undefined}
            />
          </div>
          <div className="p-2 pb-3 flex flex-col items-center">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="size-11 rounded-xl grid place-items-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Configuración"
            >
              <Settings size={18} />
            </button>
          </div>
        </nav>

        {/* Tab content */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {tab === "inbox" && (
            <MessagingInbox
              initialConversations={props.initialConversations}
              tags={props.initialTags}
              templates={props.initialTemplates}
              channels={props.initialChannels}
              statusFilter={statusFilter}
              tagFilter={tagFilter}
              onClearFilters={() => {
                setStatusFilter("all");
                setTagFilter(null);
              }}
              onConfigure={() => setSettingsOpen(true)}
            />
          )}
          {tab === "broadcasts" && (
            <MessagingBroadcasts
              initialBroadcasts={props.initialBroadcasts}
              channels={props.initialChannels.filter((c) => c.active)}
            />
          )}
          {tab === "workflows" && (
            <MessagingWorkflows initialWorkflows={props.initialWorkflows} />
          )}
          {tab === "alerts" && <MessagingAlerts initialAlerts={props.initialAlerts} />}
          {tab === "templates" && (
            <MessagingQuickReplies initialTemplates={props.initialTemplates} />
          )}
        </main>
      </div>

      <MessagingSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        channels={props.initialChannels}
        tags={props.initialTags}
      />
    </div>
  );
}

interface RailButtonProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: "default" | "urgent";
}

function RailButton({ icon: Icon, label, active, onClick, badge, badgeColor }: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative h-[60px] w-full rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-150",
        active
          ? "bg-primary/10 text-primary ring-1 ring-primary/20"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon size={18} className={cn(active && "drop-shadow-sm")} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
      {badge ? (
        <Badge
          className={cn(
            "absolute top-1 right-2 h-4 min-w-4 px-1 text-[9px] font-semibold tabular-nums rounded-full",
            badgeColor === "urgent"
              ? "bg-red-500 text-white border-0"
              : "bg-primary text-primary-foreground border-0"
          )}
        >
          {badge > 99 ? "99+" : badge}
        </Badge>
      ) : null}
    </button>
  );
}
