"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Índice de una página de contenido. En desktop va como columna sticky; en
 * celular (`chips`), como barra de píldoras pegada bajo el header (h-16) que
 * se desplaza sola hasta la sección activa. Marca la sección visible
 * (aria-current) con un IntersectionObserver; sin JS sigue siendo una lista
 * de anclas común. Las secciones necesitan `scroll-mt` para no quedar debajo
 * del header y de la barra (en celular ≈ 8.5rem).
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
  const chipsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const els = items
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    // Franja "actual": debajo de lo que tapa arriba (header 64 px + barra de
    // píldoras ≈ 60 px en celular) y hasta el 45 % de la pantalla.
    const top = variant === "chips" ? 132 : 96;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // La sección visible más arriba de la pantalla es la "actual".
        const first = items.find((it) => visible.has(it.id));
        if (first) setActive(first.id);
        // Celular: de vuelta arriba (todavía en el hero), ninguna píldora marcada.
        else if (variant === "chips" && els[0].getBoundingClientRect().top > window.innerHeight * 0.45) {
          setActive(null);
        }
      },
      { rootMargin: `-${top}px 0px -55% 0px`, threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items, variant]);

  // Celular: la píldora activa siempre a la vista (sólo scroll horizontal de
  // la barra; nunca mueve la página).
  useEffect(() => {
    const bar = chipsRef.current;
    if (variant !== "chips" || !active || !bar) return;
    const chip = Array.from(bar.querySelectorAll<HTMLAnchorElement>("a[href^='#']")).find(
      (a) => a.hash === `#${active}`,
    );
    if (!chip) return;
    const barBox = bar.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    const delta = chipBox.left - barBox.left - (barBox.width - chipBox.width) / 2;
    if (Math.abs(delta) < 4) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bar.scrollBy({ left: delta, behavior: reduce ? "auto" : "smooth" });
  }, [active, variant]);

  if (variant === "chips") {
    return (
      <nav
        ref={chipsRef}
        aria-label={label}
        className={cn(
          "sticky top-16 z-30 -mx-4 overflow-x-auto overscroll-x-contain border-b border-cream-300/80 bg-cream/90 px-4 py-2 backdrop-blur-md [scrollbar-width:none] supports-[backdrop-filter]:bg-cream/80 sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        <ul className="flex w-max gap-2">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                aria-current={active === it.id ? "location" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1 transition-[background-color,color,box-shadow] duration-300 motion-reduce:transition-none",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
                  active === it.id
                    ? "bg-forest-700 text-cream shadow-apart-sm ring-forest-700"
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
