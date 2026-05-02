"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Bell,
  BellRing,
  CheckCheck,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/lib/actions/notifications";
import type { Notification } from "@/lib/types/database";

interface NotificationsBellProps {
  /** Datos iniciales (server-side) */
  initialNotifications: Notification[];
  initialUnreadCount: number;
}

export function NotificationsBell({
  initialNotifications,
  initialUnreadCount,
}: NotificationsBellProps) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>(initialNotifications);
  const [unread, setUnread] = useState<number>(initialUnreadCount);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Refrescar al abrir el popover
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listNotifications("active", 30).then((data) => {
      if (cancelled) return;
      setItems(data);
      setUnread(
        data.filter((n) => !n.read_at && !n.dismissed_at).length
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleClickItem(n: Notification) {
    if (!n.read_at) {
      startTransition(async () => {
        await markNotificationAsRead(n.id);
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
          )
        );
        setUnread((u) => Math.max(0, u - 1));
      });
    }
    if (n.action_url) {
      setOpen(false);
      router.push(n.action_url);
    }
  }

  function handleDismiss(e: React.MouseEvent, n: Notification) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await dismissNotification(n.id);
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsAsRead();
      setItems((prev) =>
        prev.map((x) =>
          x.read_at
            ? x
            : { ...x, read_at: new Date().toISOString() }
        )
      );
      setUnread(0);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 relative"
          aria-label={`Notificaciones${unread > 0 ? `, ${unread} sin leer` : ""}`}
        >
          {unread > 0 ? (
            <BellRing className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
          {unread > 0 && (
            <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums shadow ring-2 ring-background">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[380px] p-0"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <span className="size-7 rounded-md bg-primary/15 text-primary flex items-center justify-center">
              <Bell size={14} />
            </span>
            <div>
              <div className="text-sm font-semibold leading-tight">
                Notificaciones
              </div>
              <div className="text-[10px] text-muted-foreground">
                {unread > 0 ? `${unread} sin leer` : "Todo al día"}
              </div>
            </div>
          </div>
          {unread > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px]"
              onClick={handleMarkAllRead}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCheck size={12} />
              )}
              Marcar todo
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[60vh]">
          {items.length === 0 ? (
            <div className="py-10 px-4 text-center">
              <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center mb-2">
                <Bell size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Sin notificaciones</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Las alertas y recordatorios van a aparecer acá
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onClick={() => handleClickItem(n)}
                  onDismiss={(e) => handleDismiss(e, n)}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t p-2">
          <Button
            asChild
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center text-[11px] h-7"
          >
            <Link href="/dashboard/alertas">
              Ver todas las alertas
              <ExternalLink size={11} className="ml-1" />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onClick: () => void;
  onDismiss: (e: React.MouseEvent) => void;
}

function NotificationRow({
  notification: n,
  onClick,
  onDismiss,
}: NotificationRowProps) {
  const tone = SEVERITY_TONE[n.severity];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors group flex gap-2 items-start",
          !n.read_at && "bg-primary/[0.04]"
        )}
      >
        <span
          className={cn(
            "shrink-0 size-7 rounded-md ring-1 flex items-center justify-center mt-0.5",
            tone.bg,
            tone.ring
          )}
          aria-hidden
        >
          <span
            className={cn("size-1.5 rounded-full", tone.dot)}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[12px] font-semibold leading-tight truncate",
                !n.read_at && "font-bold"
              )}
            >
              {n.title}
            </span>
            {!n.read_at && (
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
            )}
          </div>
          {n.body && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              {n.body}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-muted-foreground">
              {formatRelative(n.created_at)}
            </span>
            {n.due_at && (
              <span className="text-[10px] text-muted-foreground">
                · vence {n.due_at.slice(0, 10)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 size-6 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center"
        >
          <X size={12} />
        </button>
      </button>
    </li>
  );
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), {
      addSuffix: true,
      locale: es,
    });
  } catch {
    return "";
  }
}

const SEVERITY_TONE: Record<
  string,
  { bg: string; ring: string; dot: string }
> = {
  info: {
    bg: "bg-sky-100 dark:bg-sky-950",
    ring: "ring-sky-300/60 dark:ring-sky-700/40",
    dot: "bg-sky-500",
  },
  warning: {
    bg: "bg-amber-100 dark:bg-amber-950",
    ring: "ring-amber-300/60 dark:ring-amber-700/40",
    dot: "bg-amber-500",
  },
  critical: {
    bg: "bg-rose-100 dark:bg-rose-950",
    ring: "ring-rose-300/60 dark:ring-rose-700/40",
    dot: "bg-rose-500",
  },
  success: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    ring: "ring-emerald-300/60 dark:ring-emerald-700/40",
    dot: "bg-emerald-500",
  },
};
