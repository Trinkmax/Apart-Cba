"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BellRing, Check, X, AlertTriangle, Info, AlertCircle, CheckCircle2, ExternalLink, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { listCrmAlerts, markCrmAlertRead, dismissCrmAlert, markAllCrmAlertsRead } from "@/lib/actions/crm-alerts";
import type { Notification, NotificationSeverity } from "@/lib/types/database";

interface Props {
  initialAlerts: Notification[];
}

const SEVERITY_META: Record<NotificationSeverity, { icon: React.ComponentType<{ size?: number; className?: string }>; cls: string; bg: string }> = {
  info: { icon: Info, cls: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/30" },
  warning: { icon: AlertTriangle, cls: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30" },
  critical: { icon: AlertCircle, cls: "text-red-500", bg: "bg-red-500/10 border-red-500/30" },
  success: { icon: CheckCircle2, cls: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/30" },
};

export function CrmAlertsClient({ initialAlerts }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "unread" | "all">("active");
  const [alerts, setAlerts] = useState<Notification[]>(initialAlerts);
  const [, startTransition] = useTransition();

  const refresh = (f: typeof filter) => {
    setFilter(f);
    startTransition(async () => {
      const fresh = await listCrmAlerts(f);
      setAlerts(fresh);
    });
  };

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markCrmAlertRead(id);
      setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, read_at: new Date().toISOString() } : a));
    });
  };

  const handleDismiss = (id: string) => {
    startTransition(async () => {
      await dismissCrmAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllCrmAlertsRead();
      router.refresh();
      setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? new Date().toISOString() })));
    });
  };

  const unreadCount = alerts.filter((a) => !a.read_at).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BellRing className="size-6 text-amber-500" />
            Alertas del CRM
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Notificaciones generadas por workflows, broadcasts y eventos del CRM.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={handleMarkAllRead}>
            <CheckCheck className="size-4 mr-1.5" /> Marcar todas leídas
          </Button>
        )}
      </header>

      <div className="flex items-center gap-1.5 mb-4">
        {(["active", "unread", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => refresh(f)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md font-medium",
              filter === f ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "active" ? "Activas" : f === "unread" ? "Sin leer" : "Todas"}
          </button>
        ))}
      </div>

      {alerts.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <BellRing className="size-12 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {filter === "unread" ? "Sin alertas sin leer" : "Sin alertas activas"}
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-[calc(100vh-12rem)]">
          <div className="space-y-2">
            {alerts.map((alert) => {
              const meta = SEVERITY_META[alert.severity];
              const Icon = meta.icon;
              const isUnread = !alert.read_at;
              return (
                <div
                  key={alert.id}
                  className={cn(
                    "border rounded-lg p-3 transition-colors",
                    meta.bg,
                    isUnread && "shadow-sm",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Icon size={18} className={cn("mt-0.5 shrink-0", meta.cls)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className={cn("font-semibold", isUnread && "")}>{alert.title}</h3>
                        {isUnread && <span className="size-1.5 rounded-full bg-emerald-500" />}
                      </div>
                      {alert.body && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{alert.body}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span>{formatDistanceToNowStrict(new Date(alert.created_at), { locale: es, addSuffix: true })}</span>
                        {alert.action_url && (
                          <Link href={alert.action_url} className="inline-flex items-center gap-1 underline hover:text-foreground">
                            Abrir <ExternalLink className="size-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isUnread && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleMarkRead(alert.id)} title="Marcar como leída">
                          <Check className="size-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-red-500" onClick={() => handleDismiss(alert.id)} title="Descartar">
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
