"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "propietario", label: "Por propietario", href: "/dashboard/liquidaciones" },
  { key: "periodo", label: "Por período", href: "/dashboard/liquidaciones/periodo" },
] as const;

const SEG_W = 140; // ancho fijo por segmento (px) — indicador exacto

/**
 * Control segmentado Por propietario / Por período.
 * - Autodetecta el activo por ruta → idéntica posición en ambas páginas.
 * - Indicador deslizante animado + estado optimista + useTransition:
 *   el pill se mueve al instante aunque el server tarde en renderizar.
 */
export function SettlementsViewTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const serverActive = pathname.endsWith("/periodo") ? "periodo" : "propietario";
  const [target, setTarget] = useState<string | null>(null);
  // Optimista solo mientras la navegación está en curso; al terminar, el
  // activo se deriva de la ruta. Sin setState dentro de un effect.
  const active = isPending && target ? target : serverActive;

  const activeIndex = TABS.findIndex((t) => t.key === active);

  function go(t: (typeof TABS)[number]) {
    if (t.key === active) return;
    setTarget(t.key); // desliza el pill ya mismo
    startTransition(() => router.push(t.href));
  }

  return (
    <div
      role="tablist"
      aria-label="Vista de liquidaciones"
      className={cn(
        "relative inline-flex items-center rounded-lg bg-muted p-1 select-none transition-opacity",
        isPending && "opacity-80",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-md bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: SEG_W, transform: `translateX(${activeIndex * SEG_W}px)` }}
      />
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => go(t)}
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
