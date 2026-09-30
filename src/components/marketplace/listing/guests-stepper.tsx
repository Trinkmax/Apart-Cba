"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { guestsCountLabel } from "@/lib/marketplace/widget-quote";
import { useListingStay } from "./stay-context";

const stepButton =
  "flex size-11 items-center justify-center rounded-full border border-forest-700/25 bg-paper text-forest-700 transition-colors hover:border-forest-700/50 hover:bg-leaf-100 disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40";

/** Huéspedes: stepper 1…máximo de la unidad (botones de 44 px). */
export function GuestsStepper({
  className,
  label = "Huéspedes",
  ref,
}: {
  className?: string;
  label?: string;
  /** Botón "+" (el widget lo enfoca cuando sobran huéspedes). */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const { guests, maxGuests, setGuests } = useListingStay();
  return (
    <div className={cn("flex items-center justify-between gap-3", className)} role="group" aria-label={label}>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">{label}</p>
        <p className="mt-0.5 text-[0.9375rem] font-semibold text-ink-900" aria-live="polite">
          {guestsCountLabel(guests)}
        </p>
        <p className="text-xs text-ink-500">Hasta {maxGuests}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={stepButton}
          onClick={() => setGuests(guests - 1)}
          disabled={guests <= 1}
          aria-label="Un huésped menos"
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <span className="w-6 text-center text-base font-bold tabular-nums text-forest-700" aria-hidden>
          {guests}
        </span>
        <button
          ref={ref}
          type="button"
          className={stepButton}
          onClick={() => setGuests(guests + 1)}
          disabled={guests >= maxGuests}
          aria-label="Un huésped más"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
