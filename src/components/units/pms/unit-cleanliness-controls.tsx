"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CLEANLINESS_LABEL,
  CLEANLINESS_SHORT_LABEL,
  cleanlinessHint,
  type UnitCleanliness,
} from "@/lib/cleaning/cleanliness";
import type { CleanlinessTarget } from "./use-unit-cleanliness";

/**
 * El botón de la fila del calendario. Sucio se ve siempre, y el del día anterior
 * más suave: todavía hay alguien adentro, pero ya hay que organizar la limpieza.
 * Limpio es sólo un ícono tenue: son decenas de filas y lo normal no tiene que
 * gritar.
 */
export function CleanlinessRowButton({
  unitCode,
  state,
  canMark,
  compact = false,
  onMark,
}: {
  unitCode: string;
  state: UnitCleanliness | null;
  canMark: boolean;
  compact?: boolean;
  onMark: (target: CleanlinessTarget) => void;
}) {
  if (!state) {
    if (!canMark) return null;
    return (
      <button
        type="button"
        onClick={() => onMark("sucio")}
        title={`${unitCode} está limpio. Tocá para marcarlo sucio.`}
        aria-label={`${unitCode} está limpio. Marcar sucio`}
        className={cn(
          "pointer-events-auto relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity",
          "opacity-40 hover:opacity-100 group-hover/unit-cell:opacity-100 focus-visible:opacity-100",
          "hover:bg-cyan-500/15 hover:text-cyan-700 dark:hover:text-cyan-300",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600",
          // Área táctil más grande que el ícono.
          "size-5 after:absolute after:-inset-1 after:content-['']",
        )}
      >
        <Sparkles size={11} aria-hidden />
      </button>
    );
  }

  const label = (compact ? CLEANLINESS_SHORT_LABEL : CLEANLINESS_LABEL)[state.due];
  const hint = cleanlinessHint(state);
  const pillClass = cn(
    "pointer-events-auto relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
    compact ? "h-4 px-1 text-[9px]" : "h-[18px] px-1.5 text-[10px]",
    state.due === "tomorrow"
      ? "bg-cyan-500/15 text-cyan-800 ring-1 ring-inset ring-cyan-600/40 dark:text-cyan-200"
      : "bg-cyan-700 text-white",
  );
  if (!canMark) {
    return (
      <span className={pillClass} title={hint}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onMark("limpio")}
      title={`${hint} Tocá para marcarlo limpio.`}
      aria-label={`${unitCode}: ${CLEANLINESS_LABEL[state.due]}. ${hint} Marcar limpio`}
      className={cn(
        pillClass,
        "transition-colors after:absolute after:-inset-1 after:content-['']",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-cyan-600",
        state.due === "tomorrow" ? "hover:bg-cyan-500/25" : "hover:bg-cyan-800",
      )}
    >
      {!compact && <Sparkles size={10} aria-hidden />}
      {label}
    </button>
  );
}

/** Limpio / Sucio con las dos opciones a la vista: el popover y la ficha de la unidad. */
export function CleanlinessSwitch({
  state,
  onMark,
  disabled = false,
}: {
  state: UnitCleanliness | null;
  onMark: (target: CleanlinessTarget) => void;
  disabled?: boolean;
}) {
  const options: { value: CleanlinessTarget; label: string; active: boolean }[] = [
    { value: "limpio", label: "Limpio", active: !state },
    { value: "sucio", label: "Sucio", active: Boolean(state) },
  ];
  return (
    <div
      role="group"
      aria-label="Estado de limpieza"
      className="inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={option.active}
          // Tocar lo que ya está marcado no hace nada: un doble clic no deshace.
          onClick={() => {
            if (!option.active) onMark(option.value);
          }}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600",
            option.active
              ? option.value === "sucio"
                ? "bg-cyan-700 text-white shadow-sm"
                : "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
