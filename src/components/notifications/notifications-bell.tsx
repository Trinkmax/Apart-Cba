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
        collisionPadding={16}
        style={{
          maxHeight:
            "min(32rem, calc(var(--radix-popover-content-available-height, 32rem) - 1rem))",
        }}
        className="w-[min(22rem,calc(100vw-1rem))] p-0 flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0 bg-muted/30">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="size-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Bell size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">
                Notificaciones
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {unread > 0 ? `${unread} sin leer` : "Todo al día"}
              </div>
            </div>
          </div>
          {unread > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px] shrink-0"
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bell size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Sin notificaciones</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Las alertas y recordatorios van a aparecer acá
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
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
        </div>
        <div className="border-t shrink-0 bg-muted/30">
          <Button
            asChild
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center text-[11px] h-9 rounded-none"
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
    <li
      className={cn(
        "relative group transition-colors hover:bg-muted/40",
        !n.read_at && "bg-primary/[0.035]"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-0 bottom-0 w-[3px]",
          tone.bar,
          n.read_at && "opacity-40"
        )}
        aria-hidden
      />
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="w-full cursor-pointer text-left pl-4 pr-2 py-3 flex gap-3 items-start outline-none focus-visible:bg-muted/50"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[13px] leading-tight truncate",
                !n.read_at ? "font-semibold text-foreground" : "font-medium text-foreground/90"
              )}
            >
              {n.title}
            </span>
            {!n.read_at && (
              <span className="size-1.5 rounded-full bg-primary shrink-0" aria-hidden />
            )}
          </div>
          {n.body && (
            <p className="text-[11.5px] text-muted-foreground leading-snug line-clamp-2">
              {n.body}
            </p>
          )}
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className="text-[10.5px] text-muted-foreground/80 tabular-nums">
              {formatRelative(n.created_at)}
            </span>
            {n.due_at && (
              <>
                <span className="size-0.5 rounded-full bg-muted-foreground/40" aria-hidden />
                <span className="text-[10.5px] text-muted-foreground/80 tabular-nums">
                  vence {n.due_at.slice(0, 10)}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar"
          className="shrink-0 size-7 rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground flex items-center justify-center transition-all md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
        >
          <X size={13} />
        </button>
      </div>
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

const SEVERITY_TONE: Record<string, { bar: string }> = {
  info: { bar: "bg-sky-500" },
  warning: { bar: "bg-amber-500" },
  critical: { bar: "bg-rose-500" },
  success: { bar: "bg-emerald-500" },
};
