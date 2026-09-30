"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { SearchMode } from "@/lib/marketplace/catalog-filter";

/**
 * Selector segmentado "Por noches | Por meses". Es un radiogroup: flechas
 * izquierda/derecha cambian la opción, Tab entra y sale del grupo.
 */
export function ModeToggle({
  value,
  onChange,
  labels = { noche: "Por noches", mes: "Por meses" },
  size = "md",
  className,
  itemClassName,
  ariaLabel = "Tipo de estadía",
}: {
  value: SearchMode;
  onChange: (mode: SearchMode) => void;
  labels?: { noche: React.ReactNode; mes: React.ReactNode };
  size?: "sm" | "md";
  className?: string;
  /** Clases extra de cada opción (p. ej. menos aire en celulares angostos). */
  itemClassName?: string;
  ariaLabel?: string;
}) {
  const refs = useRef<Record<SearchMode, HTMLButtonElement | null>>({ noche: null, mes: null });
  const options: SearchMode[] = ["noche", "mes"];

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next: SearchMode = value === "noche" ? "mes" : "noche";
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex rounded-full bg-cream-200 ring-1 ring-inset ring-cream-300",
        size === "sm" ? "p-0.5" : "p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            ref={(el) => {
              refs.current[opt] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full font-apart font-semibold whitespace-nowrap outline-none transition-[background-color,color,box-shadow] duration-200",
              "focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
              size === "sm" ? "h-11 px-3.5 text-sm" : "h-11 px-4 text-[0.9375rem]",
              active ? "bg-paper text-forest-700 shadow-apart-sm" : "text-ink-600 hover:text-forest-700",
              itemClassName,
            )}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}
