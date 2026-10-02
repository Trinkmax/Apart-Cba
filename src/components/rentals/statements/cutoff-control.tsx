"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, monthOf } from "@/lib/rentals/ymd";

/**
 * Fecha de corte del tablero "Para rendir" (en la URL: `?corte=`). Atajos para
 * los dos casos de todos los meses: hoy, o el cierre del mes pasado.
 */
export function CutoffControl({ cutoff, today }: { cutoff: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const endOfLastMonth = addDays(monthOf(today), -1);

  function go(v: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > today) return;
    start(() => router.replace(v === today ? "/dashboard/alquileres/rendiciones" : `/dashboard/alquileres/rendiciones?corte=${v}`, { scroll: false }));
  }

  const chip = (value: string, label: string) => (
    <button
      type="button"
      onClick={() => go(value)}
      aria-pressed={cutoff === value}
      className={cn(
        "h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors",
        cutoff === value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
      <span className="hidden pl-1.5 pr-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">Cobros hasta</span>
      {chip(today, "Hoy")}
      {chip(endOfLastMonth, "Fin del mes pasado")}
      <input
        type="date"
        value={cutoff}
        max={today}
        onChange={(e) => go(e.target.value)}
        aria-label="Fecha de corte"
        className="h-8 rounded-md border bg-background px-2 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {pending && <Loader2 size={14} className="mx-1 animate-spin text-muted-foreground" />}
    </div>
  );
}
