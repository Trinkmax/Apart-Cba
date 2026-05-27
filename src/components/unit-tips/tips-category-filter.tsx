"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { UNIT_TIP_CATEGORIES, UNIT_TIP_CATEGORY_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { UnitTipCategory } from "@/lib/types/database";

/**
 * Chips horizontales scrolleables para filtrar el feed por categoría. La
 * categoría se persiste como `?cat=` en la URL — la página entera (server
 * component) se re-renderiza con la nueva lista filtrada por SSR. Permite
 * compartir un link a "consejos importantes" o volver con back-button.
 */
export function TipsCategoryFilter({ value }: { value: UnitTipCategory | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setCategory(next: UnitTipCategory | null) {
    const params = new URLSearchParams(searchParams);
    if (next === null) {
      params.delete("cat");
    } else {
      params.set("cat", next);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        "flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none transition-opacity",
        isPending && "opacity-50"
      )}
    >
      <button
        type="button"
        onClick={() => setCategory(null)}
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
          value === null
            ? "bg-foreground text-background border-foreground"
            : "border-input bg-muted/30 text-muted-foreground hover:bg-muted"
        )}
      >
        Todos
      </button>
      {UNIT_TIP_CATEGORIES.map((cat) => {
        const meta = UNIT_TIP_CATEGORY_META[cat];
        const active = value === cat;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(active ? null : cat)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
              active
                ? "ring-2 ring-offset-1"
                : "border-input bg-muted/30 text-muted-foreground hover:bg-muted"
            )}
            style={
              active
                ? {
                    backgroundColor: meta.color + "1a",
                    color: meta.color,
                    borderColor: meta.color + "60",
                    ["--tw-ring-color" as string]: meta.color + "80",
                  }
                : undefined
            }
          >
            <span className="text-sm leading-none">{meta.emoji}</span>
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
