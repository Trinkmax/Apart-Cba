"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Índice de una página de contenido. En desktop va como columna sticky; en
 * mobile, como fila de píldoras que se desplaza. Marca la sección visible
 * (aria-current) con un IntersectionObserver; sin JS sigue siendo una lista
 * de anclas común.
 */
export function PageToc({
  items,
  label = "En esta página",
  variant,
  className,
}: {
  items: TocItem[];
  label?: string;
  variant: "aside" | "chips";
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // La sección visible más arriba de la pantalla es la "actual".
        const first = items.find((it) => visible.has(it.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  if (variant === "chips") {
    return (
      <nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none]", className)}>
        <ul className="flex w-max gap-2 pb-1">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                aria-current={active === it.id ? "location" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                  active === it.id
                    ? "bg-forest-700 text-cream ring-forest-700"
                    : "bg-paper text-forest-700 ring-cream-300 hover:bg-white",
                )}
              >
                {it.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={label} className={cn("text-sm", className)}>
      <p className="mb-3 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-forest-600">{label}</p>
      <ul className="space-y-0.5 border-l border-cream-300">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              aria-current={active === it.id ? "location" : undefined}
              className={cn(
                "-ml-px flex min-h-10 items-center border-l-2 pl-4 font-semibold transition-colors",
                "outline-none focus-visible:rounded-r-lg focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                active === it.id
                  ? "border-coral-500 text-forest-700"
                  : "border-transparent text-ink-500 hover:border-cream-400 hover:text-forest-700",
              )}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
