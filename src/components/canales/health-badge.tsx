import {
  CircleCheck,
  CircleAlert,
  CircleX,
  CircleDashed,
  CirclePause,
  CircleEllipsis,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelLinkHealth } from "@/lib/channels/types";

/**
 * Estado de salud de una conexión: color + icono + texto (nunca solo color).
 */
const META: Record<
  ChannelLinkHealth,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; className: string }
> = {
  healthy: {
    label: "Conectada",
    icon: CircleCheck,
    className: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  },
  degraded: {
    label: "Degradada",
    icon: CircleAlert,
    className: "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  },
  critical: {
    label: "Crítica",
    icon: CircleX,
    className: "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30",
  },
  verifying: {
    label: "Esperando verificación",
    icon: CircleEllipsis,
    className: "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/30",
  },
  paused: {
    label: "Pausada",
    icon: CirclePause,
    className: "text-muted-foreground bg-muted border-border",
  },
  draft: {
    label: "Borrador",
    icon: CircleDashed,
    className: "text-muted-foreground bg-muted border-border",
  },
};

export function HealthBadge({
  health,
  className,
  compact = false,
}: {
  health: ChannelLinkHealth;
  className?: string;
  compact?: boolean;
}) {
  const m = META[health];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        m.className,
        className,
      )}
    >
      <Icon size={12} className="shrink-0" />
      {compact ? m.label.split(" ")[0] : m.label}
    </span>
  );
}

export function healthLabel(health: ChannelLinkHealth): string {
  return META[health].label;
}
