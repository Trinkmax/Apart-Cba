"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { expiryInfo } from "@/lib/marketplace/staff-helpers";

/**
 * "Vence en 5 h 20 min" que se actualiza solo cada minuto (rojo si faltan
 * menos de 6 h). Arranca con la hora del server para que la primera pintura
 * del cliente coincida con el HTML.
 */
export function ExpiryLabel({
  expiresAt,
  serverNow,
  className,
}: {
  expiresAt: string;
  serverNow: number;
  className?: string;
}) {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const info = expiryInfo(expiresAt, now);
  if (!info.label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        info.urgent ? "text-destructive" : "text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <Clock className="size-3.5" aria-hidden />
      {info.label}
    </span>
  );
}
