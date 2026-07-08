"use client";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "propietario", label: "Por propietario" },
  { key: "periodo", label: "Por período" },
] as const;

export type SettlementsTab = (typeof TABS)[number]["key"];

const SEG_W = 140; // ancho fijo por segmento (px) — indicador exacto

/**
 * Control segmentado Por propietario / Por período — controlado.
 *
 * Antes navegaba entre dos rutas (`router.push`), lo que hacía un round-trip
 * al server en cada cambio de tab. Ahora es puro estado de cliente: el padre
 * (`LiquidacionesTabs`) alterna el panel activo sin navegar, así el cambio es
 * instantáneo. El indicador deslizante se mueve por `value`.
 */
export function SettlementsViewTabs({
  value,
  onChange,
}: {
  value: SettlementsTab;
  onChange: (value: SettlementsTab) => void;
}) {
  const activeIndex = TABS.findIndex((t) => t.key === value);

  return (
    <div
      role="tablist"
      aria-label="Vista de liquidaciones"
      className="relative inline-flex items-center rounded-lg bg-muted p-1 select-none"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-md bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: SEG_W, transform: `translateX(${activeIndex * SEG_W}px)` }}
      />
      {TABS.map((t) => {
        const isActive = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            style={{ width: SEG_W }}
            className={cn(
              "relative z-10 rounded-md px-3 py-1.5 text-sm text-center transition-colors duration-200",
              isActive
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
