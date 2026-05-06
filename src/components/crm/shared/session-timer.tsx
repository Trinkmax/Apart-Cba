"use client";

import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SESSION_HOURS = 24;

interface SessionTimerProps {
  lastCustomerMessageAt: string | null;
}

export function SessionTimer({ lastCustomerMessageAt }: SessionTimerProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!lastCustomerMessageAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs">
        <AlertTriangle className="size-3" />
        Solo template
      </span>
    );
  }

  const lastTs = new Date(lastCustomerMessageAt).getTime();
  // eslint-disable-next-line react-hooks/purity -- el `tick` state fuerza re-render cada minuto; lectura en render es intencional
  const elapsed = Date.now() - lastTs;
  const remainingMs = SESSION_HOURS * 3_600_000 - elapsed;

  if (remainingMs <= 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-xs font-medium">
        <AlertTriangle className="size-3" />
        Sesión cerrada
      </span>
    );
  }

  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const isCritical = remainingMs < 3_600_000; // < 1h
  const isWarning = remainingMs < 6 * 3_600_000; // < 6h

  // Mantener `tick` referenciado para que el linter no lo borre
  void tick;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        isCritical
          ? "bg-red-500/15 text-red-600 dark:text-red-400"
          : isWarning
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <Clock className="size-3" />
      {hours}h {minutes}m
    </span>
  );
}
