"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { descriptionBlocks, descriptionWeight } from "@/lib/marketplace/widget-quote";

/** Más de esto se colapsa con "Leer más". */
const COLLAPSE_WEIGHT = 700;

/**
 * Descripción de la unidad tal como la carga el equipo: respeta saltos de
 * línea y viñetas ("•", "-"). Si es larga, se muestra el principio y "Leer más".
 */
export function DescriptionBlock({ text }: { text: string }) {
  const blocks = descriptionBlocks(text);
  const collapsible = descriptionWeight(blocks) > COLLAPSE_WEIGHT;
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (blocks.length === 0) return null;
  const collapsed = collapsible && !open;

  return (
    <div>
      <div
        id={contentId}
        className={cn(
          "relative space-y-4 text-[1rem] leading-relaxed text-ink-700 sm:text-[1.0625rem]",
          collapsed && "max-h-[15.5rem] overflow-hidden",
        )}
      >
        {blocks.map((b, i) =>
          b.kind === "ul" ? (
            <ul key={i} className="space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-coral-500" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>
              {b.lines.map((line, j) => (
                <span key={j}>
                  {j > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
          ),
        )}
        {collapsed ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-cream to-transparent" />
        ) : null}
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={contentId}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.9375rem] font-bold text-forest-700 underline decoration-forest-700/30 underline-offset-4 hover:decoration-forest-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
        >
          {open ? "Leer menos" : "Leer más"}
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
