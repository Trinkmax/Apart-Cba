"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  CheckCheck,
  Clock,
  ExternalLink,
  House,
  Loader2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CuotaBadge } from "@/components/payment-schedule/cuota-badge";
import { MarkPaidDialog } from "@/components/payment-schedule/mark-paid-dialog";
import {
  dismissAllNotifications,
  dismissNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/lib/actions/notifications";
import type {
  BookingPaymentScheduleWithBooking,
  CashAccount,
  Notification,
} from "@/lib/types/database";

interface AlertsClientProps {
  initialNotifications: Notification[];
  initialUnreadCount: number;
  upcomingSchedule: BookingPaymentScheduleWithBooking[];
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
}

export function AlertsClient({
  initialNotifications,
  initialUnreadCount,
  upcomingSchedule,
  accounts,
}: AlertsClientProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialNotifications);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"unread" | "active" | "all">(
    initialUnreadCount > 0 ? "unread" : "active"
  );

  const filteredItems = useMemo(() => {
    if (tab === "unread")
      return items.filter((n) => !n.read_at && !n.dismissed_at);
    if (tab === "active") return items.filter((n) => !n.dismissed_at);
    return items;
  }, [items, tab]);

  const overdueCuotas = upcomingSchedule.filter((s) => s.status === "overdue");
  const upcomingCuotas = upcomingSchedule.filter(
    (s) => s.status !== "overdue"
  );

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
    if (n.action_url) router.push(n.action_url);
  }

  function handleDismiss(id: string) {
    startTransition(async () => {
      await dismissNotification(id);
      setItems((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, dismissed_at: new Date().toISOString() }
            : x
        )
      );
      const item = items.find((x) => x.id === id);
      if (item && !item.read_at) setUnread((u) => Math.max(0, u - 1));
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      try {
        await markAllNotificationsAsRead();
        setItems((prev) =>
          prev.map((x) =>
            x.read_at
              ? x
              : { ...x, read_at: new Date().toISOString() }
          )
        );
        setUnread(0);
        toast.success("Todas marcadas como leídas");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDismissAll() {
    if (
      !confirm("¿Descartar TODAS las notificaciones activas? Las podrás ver en 'Todas'.")
    )
      return;
    startTransition(async () => {
      try {
        await dismissAllNotifications();
        const nowISO = new Date().toISOString();
        setItems((prev) =>
          prev.map((x) =>
            x.dismissed_at ? x : { ...x, dismissed_at: nowISO }
          )
        );
        setUnread(0);
        toast.success("Notificaciones descartadas");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Próximos cobros (rail derecho en mobile, lateral en desktop) */}
      <div className="lg:col-span-1 space-y-6 order-2 lg:order-2">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="size-7 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 flex items-center justify-center">
                <AlertCircle size={14} />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Cuotas vencidas</h2>
                <p className="text-[10px] text-muted-foreground">
                  Cobros que ya pasaron su fecha
                </p>
              </div>
            </div>
            {overdueCuotas.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {overdueCuotas.length}
              </Badge>
            )}
          </div>
          {overdueCuotas.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              Sin vencidas — felicitaciones
            </p>
          ) : (
            <ul className="space-y-2">
              {overdueCuotas.map((s) => (
                <CuotaListItem
                  key={s.id}
                  schedule={s}
                  accounts={accounts}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="size-7 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                <Clock size={14} />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Próximos cobros</h2>
                <p className="text-[10px] text-muted-foreground">
                  En los próximos 30 días
                </p>
              </div>
            </div>
            {upcomingCuotas.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {upcomingCuotas.length}
              </Badge>
            )}
          </div>
          {upcomingCuotas.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              No hay cuotas en el horizonte
            </p>
          ) : (
            <ul className="space-y-2">
              {upcomingCuotas.slice(0, 12).map((s) => (
                <CuotaListItem
                  key={s.id}
                  schedule={s}
                  accounts={accounts}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Stream de notificaciones */}
      <div className="lg:col-span-2 order-1 lg:order-1">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap">
            <Tabs value={tab} onValueChange={(v) => setTab(v as never)}>
              <TabsList className="h-8">
                <TabsTrigger value="unread" className="text-xs">
                  Sin leer
                  {unread > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold tabular-nums">
                      {unread}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="active" className="text-xs">
                  Activas
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  Todas
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1"
                  onClick={handleMarkAllRead}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <CheckCheck size={12} />
                  )}
                  Marcar todo leído
                </Button>
              )}
              {tab === "active" && filteredItems.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] gap-1 text-muted-foreground"
                  onClick={handleDismissAll}
                  disabled={isPending}
                >
                  <X size={12} />
                  Descartar todas
                </Button>
              )}
            </div>
          </div>

          <TabsContents
            tab={tab}
            items={filteredItems}
            onClick={handleClickItem}
            onDismiss={handleDismiss}
          />
        </Card>
      </div>
    </div>
  );
}

interface TabsContentsProps {
  tab: "unread" | "active" | "all";
  items: Notification[];
  onClick: (n: Notification) => void;
  onDismiss: (id: string) => void;
}

function TabsContents({ items, onClick, onDismiss }: TabsContentsProps) {
  if (items.length === 0) {
    return (
      <div className="py-16 px-6 text-center">
        <div className="mx-auto size-14 rounded-full bg-muted flex items-center justify-center mb-3">
          <Bell size={22} className="text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">Sin notificaciones</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
          Las alertas y recordatorios de cobros van a aparecer acá
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((n) => (
        <NotifRow
          key={n.id}
          notification={n}
          onClick={() => onClick(n)}
          onDismiss={() => onDismiss(n.id)}
        />
      ))}
    </ul>
  );
}

function NotifRow({
  notification: n,
  onClick,
  onDismiss,
}: {
  notification: Notification;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const tone = SEVERITY_TONE[n.severity];
  return (
    <li
      className={cn(
        "px-4 py-3 hover:bg-muted/30 transition-colors group flex gap-3 items-start",
        !n.read_at && !n.dismissed_at && "bg-primary/[0.04]",
        n.dismissed_at && "opacity-50"
      )}
    >
      <span
        className={cn(
          "shrink-0 size-9 rounded-lg ring-1 flex items-center justify-center mt-0.5",
          tone.bg,
          tone.ring
        )}
        aria-hidden
      >
        <span className={cn("size-2 rounded-full", tone.dot)} />
      </span>
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-medium leading-tight",
              !n.read_at && !n.dismissed_at && "font-semibold"
            )}
          >
            {n.title}
          </span>
          {!n.read_at && !n.dismissed_at && (
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
          )}
        </div>
        {n.body && (
          <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
          <span>{formatRelative(n.created_at)}</span>
          {n.due_at && <span>· vence {n.due_at.slice(0, 10)}</span>}
          {n.action_url && (
            <span className="inline-flex items-center gap-0.5 text-primary">
              <ExternalLink size={9} /> Abrir
            </span>
          )}
          {n.dismissed_at && <span>· descartada</span>}
        </div>
      </button>
      {!n.dismissed_at && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 size-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center"
        >
          <X size={13} />
        </button>
      )}
    </li>
  );
}

function CuotaListItem({
  schedule,
  accounts,
}: {
  schedule: BookingPaymentScheduleWithBooking;
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
}) {
  const [paidOpen, setPaidOpen] = useState(false);
  const guest = schedule.booking?.guest?.full_name ?? "Inquilino";
  const unit = schedule.booking?.unit?.code;
  const remaining = Math.max(
    0,
    Number(schedule.expected_amount) - Number(schedule.paid_amount ?? 0)
  );
  return (
    <li className="rounded-lg border bg-card hover:bg-muted/30 transition-colors p-2.5">
      <div className="flex items-start gap-2">
        <CuotaBadge
          schedule={schedule}
          bookingId={schedule.booking_id}
          accounts={accounts}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">{guest}</div>
          {unit && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <House size={9} /> Unidad {unit}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            Vence {schedule.due_date}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="font-mono text-[11px] tabular-nums">
          {schedule.currency}{" "}
          {remaining.toLocaleString("es-AR", {
            maximumFractionDigits: 0,
          })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] gap-1 px-2"
            asChild
          >
            <Link href={`/dashboard/reservas/${schedule.booking_id}`}>
              Ver
            </Link>
          </Button>
          {schedule.status !== "paid" && schedule.status !== "cancelled" && (
            <Button
              type="button"
              size="sm"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={() => setPaidOpen(true)}
            >
              <CalendarCheck size={10} />
              Cobrar
            </Button>
          )}
        </div>
      </div>
      <MarkPaidDialog
        schedule={schedule}
        accounts={accounts}
        open={paidOpen}
        onOpenChange={setPaidOpen}
      />
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
