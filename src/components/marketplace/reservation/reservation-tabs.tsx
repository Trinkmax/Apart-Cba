"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type TabKey = "proximas" | "anteriores";

/**
 * Pestañas "Próximas / Anteriores" de Mis reservas. Las listas llegan ya
 * renderizadas desde el servidor; acá sólo se alterna cuál se ve (instantáneo,
 * con el patrón de pestañas accesible: flechas, Inicio/Fin, roving tabindex).
 */
export function ReservationTabs({
  upcoming,
  past,
  upcomingCount,
  pastCount,
  defaultTab = "proximas",
}: {
  upcoming: React.ReactNode;
  past: React.ReactNode;
  upcomingCount: number;
  pastCount: number;
  defaultTab?: TabKey;
}) {
  const id = useId();
  const [tab, setTab] = useState<TabKey>(defaultTab);
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({ proximas: null, anteriores: null });
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "proximas", label: "Próximas", count: upcomingCount },
    { key: "anteriores", label: "Anteriores", count: pastCount },
  ];

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const order: TabKey[] = ["proximas", "anteriores"];
    const i = order.indexOf(tab);
    let next: TabKey | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") next = order[(i + 1) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Tus reservas"
        className="inline-flex rounded-full bg-cream-200 p-1 ring-1 ring-inset ring-cream-300"
      >
        {tabs.map((t) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={onKeyDown}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full px-5 text-[0.9375rem] font-semibold outline-none transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-forest-500/30",
                selected ? "bg-paper text-forest-700 shadow-apart-sm" : "text-ink-600 hover:text-forest-700",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "min-w-6 rounded-full px-1.5 text-center text-xs font-bold tabular-nums",
                  selected ? "bg-leaf-100 text-forest-700" : "bg-cream-300/70 text-ink-600",
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${id}-panel-${t.key}`}
          aria-labelledby={`${id}-tab-${t.key}`}
          hidden={tab !== t.key}
          className="mt-6"
        >
          {t.key === "proximas" ? upcoming : past}
        </div>
      ))}
    </div>
  );
}
