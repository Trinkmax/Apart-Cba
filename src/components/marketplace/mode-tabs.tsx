"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";
import type { TKey } from "@/lib/i18n/dict";

/**
 * Tabs de modo de estadía — reemplazan a las viejas category chips.
 * Dos modos que mapean a `units.default_mode` vía el query param `modo`:
 * Temporales (default, sin param) y Mensuales (`?modo=mensual`).
 * Las unidades "mixto" aparecen en ambos (ver searchListings).
 */
const TABS: Array<{
  id: "temporales" | "mensuales";
  labelKey: TKey;
  subKey: TKey;
  modo: "mensual" | null;
}> = [
  { id: "temporales", labelKey: "mode.temporales", subKey: "mode.temporales.sub", modo: null },
  { id: "mensuales", labelKey: "mode.mensuales", subKey: "mode.mensuales.sub", modo: "mensual" },
];

export function ModeTabs({ basePath = "/buscar" }: { basePath?: string }) {
  const t = useT();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    const tick = setTimeout(onScroll, 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(tick);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // En el home, sobre el hero: variant "hero" (glass, texto blanco).
  // En cualquier otro caso: solid bar arriba.
  const isHome = pathname === "/";
  const hero = isHome && !scrolled;

  const activeMensual = searchParams.get("modo") === "mensual";

  function hrefFor(modo: "mensual" | null): string {
    // En /buscar el toggle preserva fechas/huéspedes/filtros; desde el home
    // (u otra página) navega a una búsqueda limpia del modo elegido.
    const next = new URLSearchParams(pathname === basePath ? searchParams : undefined);
    if (modo) next.set("modo", modo);
    else next.delete("modo");
    const qs = next.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div
      className={cn(
        "sticky top-20 z-30 transition-all duration-300",
        hero
          ? "bg-transparent"
          : "bg-white/85 backdrop-blur-xl border-b border-neutral-200/80",
      )}
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="flex justify-center py-3 md:py-3.5">
          <div
            className={cn(
              "relative grid grid-cols-2 rounded-full p-1 transition-colors duration-300",
              hero
                ? "bg-white/10 border border-white/25 backdrop-blur-md"
                : "bg-neutral-100 border border-neutral-200/80",
            )}
          >
            {/* Píldora deslizante detrás de la tab activa */}
            <span
              aria-hidden
              className={cn(
                "absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-300 ease-out",
                hero ? "bg-white shadow-md" : "bg-white shadow-sm border border-neutral-200/60",
                activeMensual && "translate-x-full",
              )}
            />
            {TABS.map((tab) => {
              const isActive = tab.id === "mensuales" ? activeMensual : !activeMensual;
              return (
                <Link
                  key={tab.id}
                  href={hrefFor(tab.modo)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative z-10 flex flex-col items-center justify-center rounded-full",
                    "px-7 sm:px-9 md:px-11 py-1.5 transition-colors duration-300",
                    isActive
                      ? "text-neutral-900"
                      : hero
                        ? "text-white/85 hover:text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.35)]"
                        : "text-neutral-500 hover:text-neutral-900",
                  )}
                >
                  <span className="text-[13.5px] md:text-sm font-semibold leading-tight whitespace-nowrap">
                    {t(tab.labelKey)}
                  </span>
                  <span
                    className={cn(
                      "text-[9.5px] font-medium uppercase tracking-[0.14em] leading-tight whitespace-nowrap",
                      isActive ? "text-neutral-500" : "opacity-75",
                    )}
                  >
                    {t(tab.subKey)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
