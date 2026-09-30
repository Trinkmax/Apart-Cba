"use client";

import { useId, useSyncExternalStore } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Media query como estado, con la API canónica de React: en el server (y en
 * la hidratación) vale `serverValue`; después, lo que diga el navegador.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** ≥ 768 px: popovers; debajo, hojas a pantalla completa. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}

/**
 * Contador − n + con botones de 44 px. El valor se anuncia (aria-live) y los
 * botones dicen qué hacen ("Sumar un huésped").
 */
export function Stepper({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  format,
  decLabel,
  incLabel,
  className,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  format: (n: number) => string;
  decLabel: string;
  incLabel: string;
  className?: string;
}) {
  const id = useId();
  const btn =
    "grid size-11 shrink-0 place-items-center rounded-full border border-cream-400 bg-paper text-forest-700 transition-colors " +
    "hover:border-forest-700/40 hover:bg-cream-50 outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40 " +
    "disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-labelledby={`${id}-label`} className={cn("flex items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <p id={`${id}-label`} className="font-apart text-[0.9375rem] font-semibold text-ink-900">
          {label}
        </p>
        {hint ? <p className="text-[0.8125rem] text-ink-500">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={decLabel}
        >
          <Minus aria-hidden className="size-4" strokeWidth={2.5} />
        </button>
        <output aria-live="polite" className="min-w-[4.5rem] text-center font-apart text-[0.9375rem] font-bold tabular-nums text-ink-900">
          {format(value)}
        </output>
        <button
          type="button"
          className={btn}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={incLabel}
        >
          <Plus aria-hidden className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
