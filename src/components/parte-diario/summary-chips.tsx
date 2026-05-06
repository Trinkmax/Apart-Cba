"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PARTE_DIARIO_SECTION_META, type ParteDiarioSectionKey } from "@/lib/constants";

interface ChipDef {
  key: ParteDiarioSectionKey;
  count: number;
}

interface SummaryChipsProps {
  chips: ChipDef[];
  className?: string;
}

/**
 * 5 chips con count-up animado de 0 → N en 350ms ease-out. Los chips de count=0
 * se renderizan en estado mute para no robar atención visual.
 */
export function SummaryChips({ chips, className }: SummaryChipsProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {chips.map((c) => (
        <CountUpChip key={c.key} chip={c} />
      ))}
    </div>
  );
}

function CountUpChip({ chip }: { chip: ChipDef }) {
  const meta = PARTE_DIARIO_SECTION_META[chip.key];
  const [renderedTarget, setRenderedTarget] = useState(chip.count);
  const [value, setValue] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  // Patrón "reset state on prop change" de React: setState en render (no en effect).
  // Sync 0 cuando count vuelve a 0 sin disparar el efecto de animación.
  if (renderedTarget !== chip.count) {
    setRenderedTarget(chip.count);
    setValue(0);
  }

  useEffect(() => {
    const target = chip.count;
    if (target === 0) return;
    let raf = 0;
    startedAtRef.current = null;
    const tick = (ts: number) => {
      if (startedAtRef.current === null) startedAtRef.current = ts;
      const elapsed = ts - startedAtRef.current;
      const t = Math.min(1, elapsed / 350);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chip.count]);

  const muted = chip.count === 0;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ring-1 transition-colors",
        muted ? "bg-muted/40 ring-border" : meta.bgClass + " " + meta.ringClass + " border-transparent",
      )}
    >
      <span className={cn("size-2 rounded-full", muted ? "bg-muted-foreground/40" : meta.dotClass)} />
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-wide leading-none",
          muted ? "text-muted-foreground" : meta.textClass,
        )}
      >
        {meta.short}
      </span>
      <span
        className={cn(
          "text-base font-bold leading-none tabular-nums",
          muted ? "text-muted-foreground/60" : meta.textClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}
