"use client";

import { Check } from "lucide-react";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { cn } from "@/lib/utils";
import { WIZARD_STEPS, type WizardStepKey } from "./wizard-state";

/**
 * Barra de pasos: progreso + pasos clickeables. Se puede volver a cualquier
 * paso ya visitado; los que tienen algo para corregir se marcan en ámbar.
 */
export function WizardStepsBar({
  current,
  visited,
  flagged,
  onGo,
}: {
  current: number;
  visited: number;
  flagged: Set<WizardStepKey>;
  onGo: (index: number) => void;
}) {
  const total = WIZARD_STEPS.length;
  const pct = ((current + 1) / total) * 100;
  return (
    <nav aria-label="Pasos del contrato" className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">
          Paso {current + 1} de {total} <span className="text-muted-foreground">· {WIZARD_STEPS[current].label}</span>
        </span>
        <span className="text-muted-foreground tabular-nums">{Math.round(pct)} %</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
        <div className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${pct}%`, backgroundColor: RENTALS_ACCENT }} />
      </div>
      <ol className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1">
        {WIZARD_STEPS.map((s, i) => {
          const isCurrent = i === current;
          const reachable = i <= visited;
          const done = i < current || (i <= visited && i !== current);
          const warn = flagged.has(s.key);
          return (
            <li key={s.key} className="shrink-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onGo(i)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full h-8 pl-1 pr-2.5 text-xs transition-colors",
                  isCurrent ? "font-semibold text-foreground" : reachable ? "text-muted-foreground hover:text-foreground hover:bg-accent/40" : "text-muted-foreground/50 cursor-not-allowed",
                )}
                style={isCurrent ? { backgroundColor: `${RENTALS_ACCENT}14` } : undefined}
              >
                <span
                  className={cn("size-6 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums border", !isCurrent && !done && "bg-card")}
                  style={
                    warn
                      ? { backgroundColor: "#f59e0b", borderColor: "#f59e0b", color: "white" }
                      : isCurrent
                        ? { backgroundColor: RENTALS_ACCENT, borderColor: RENTALS_ACCENT, color: "white" }
                        : done
                          ? { backgroundColor: `${RENTALS_ACCENT}1f`, borderColor: `${RENTALS_ACCENT}55`, color: RENTALS_ACCENT }
                          : undefined
                  }
                >
                  {done && !warn && !isCurrent ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn(isCurrent ? "inline" : "hidden md:inline")}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
