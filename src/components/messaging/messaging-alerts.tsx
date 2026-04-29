"use client";

import { useState, useTransition } from "react";
import {
  BellRing,
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  MessageCircle,
  User,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { resolveAlert } from "@/lib/actions/messaging";
import { formatTimeAgo } from "@/lib/format";
import { SectionHeader } from "./section-header";
import { toast } from "sonner";
import type {
  MessagingAlert,
  MessagingAlertSeverity,
  MessagingAlertType,
  MessagingContact,
} from "@/lib/types/database";

type AlertItem = MessagingAlert & {
  conversation: {
    id: string;
    contact: Pick<MessagingContact, "display_name" | "external_id" | "channel_type">;
  } | null;
};

const TYPE_LABEL: Record<MessagingAlertType, string> = {
  unanswered: "Sin respuesta",
  vip: "Huésped VIP",
  negative_sentiment: "Sentimiento negativo",
  sla_breach: "SLA superado",
  workflow_failure: "Workflow falló",
  channel_error: "Error de canal",
};

const SEVERITY_META: Record<
  MessagingAlertSeverity,
  {
    icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
    color: string;
    bg: string;
    ring: string;
    ringSolid: string;
  }
> = {
  info: {
    icon: Info,
    color: "#3b82f6",
    bg: "bg-blue-500/10",
    ring: "ring-blue-500/30",
    ringSolid: "border-blue-500/40",
  },
  warning: {
    icon: AlertTriangle,
    color: "#f59e0b",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
    ringSolid: "border-amber-500/40",
  },
  urgent: {
    icon: AlertCircle,
    color: "#ef4444",
    bg: "bg-red-500/10",
    ring: "ring-red-500/30",
    ringSolid: "border-red-500/40",
  },
};

interface Props {
  initialAlerts: AlertItem[];
}

export function MessagingAlerts({ initialAlerts }: Props) {
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);

  return (
    <>
      <SectionHeader
        title="Alertas"
        description="Eventos que requieren tu atención"
        icon={BellRing}
        iconColor="text-red-500"
      />

      <div className="flex-1 overflow-y-auto p-6">
        {alerts.length === 0 ? (
          <div className="grid place-items-center py-20">
            <div className="text-center max-w-md space-y-3">
              <div className="size-14 mx-auto rounded-2xl bg-emerald-500/10 grid place-items-center">
                <Check className="size-7 text-emerald-500" />
              </div>
              <h3 className="text-base font-semibold">Todo al día</h3>
              <p className="text-sm text-muted-foreground">
                No tenés alertas pendientes. Las alertas aparecen automáticamente cuando
                detectamos respuestas pendientes, errores de canal o sentimientos negativos.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-w-[1200px]">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onResolved={() =>
                  setAlerts((prev) => prev.filter((a) => a.id !== alert.id))
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AlertRow({
  alert,
  onResolved,
}: {
  alert: AlertItem;
  onResolved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const meta = SEVERITY_META[alert.severity];
  const Icon = meta.icon;

  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 flex items-start gap-3 transition-colors",
        meta.ringSolid
      )}
    >
      <div className={cn("size-10 rounded-lg grid place-items-center shrink-0", meta.bg)}>
        <Icon size={18} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold leading-tight">{alert.title}</h3>
          <span
            className="text-[9px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
          >
            {TYPE_LABEL[alert.alert_type]}
          </span>
        </div>
        {alert.body && (
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{alert.body}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {formatTimeAgo(alert.created_at)}
          </span>
          {alert.conversation?.contact && (
            <span className="inline-flex items-center gap-1">
              <User size={11} />
              {alert.conversation.contact.display_name ?? alert.conversation.contact.external_id}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {alert.conversation && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => {
              // En una versión futura: scrollear / pre-seleccionar la conversación.
              toast.info("Andá a la pestaña Inbox para ver la conversación");
            }}
          >
            <MessageCircle size={12} /> Abrir
          </Button>
        )}
        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await resolveAlert(alert.id);
                onResolved();
                toast.success("Alerta resuelta");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error");
              }
            })
          }
        >
          <Check size={12} /> Resolver
        </Button>
      </div>
    </article>
  );
}
