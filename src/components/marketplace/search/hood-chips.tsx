"use client";

import { cn } from "@/lib/utils";

/**
 * Chips de barrios con el conteo según los demás filtros (scroll horizontal).
 * Se muestran los barrios con resultados y, siempre, el elegido.
 */
export function HoodChips({
  hoods,
  counts,
  total,
  value,
  onChange,
  className,
}: {
  hoods: { name: string; slug: string; count: number }[];
  counts: Map<string, number>;
  /** Resultados sin filtrar por barrio (chip "Todos"). */
  total: number;
  value: string | null;
  onChange: (slug: string | null) => void;
  className?: string;
}) {
  const visible = hoods.filter((h) => (counts.get(h.slug) ?? 0) > 0 || h.slug === value);
  if (visible.length === 0) return null;

  return (
    <nav aria-label="Barrios" className={cn("relative", className)}>
      {/* `relative`: los sr-only de cada chip son absolute; sin esto su bloque
          contenedor es el <nav> y escapan del scroll, estirando el body. */}
      {/* < lg: riel a sangre que se esfuma en los bordes (se nota que sigue). */}
      <ul
        className={cn(
          "no-scrollbar relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
          "max-sm:scroll-px-4 sm:max-lg:scroll-px-6 max-lg:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1.75rem),transparent)]",
        )}
      >
        <li className="snap-start">
          <Chip active={value == null} onClick={() => onChange(null)} label="Todos" count={total} />
        </li>
        {visible.map((h) => (
          <li key={h.slug} className="snap-start">
            <Chip
              active={value === h.slug}
              onClick={() => onChange(value === h.slug ? null : h.slug)}
              label={h.name}
              count={counts.get(h.slug) ?? 0}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 font-apart text-[0.9375rem] font-semibold outline-none transition-colors duration-200",
        "focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
        active
          ? "bg-forest-700 text-cream shadow-apart-sm"
          : "bg-paper text-ink-800 ring-1 ring-inset ring-cream-300 hover:ring-forest-700/35",
      )}
    >
      {label}
      <span
        className={cn(
          "min-w-6 rounded-full px-1.5 text-center text-[0.75rem] font-bold tabular-nums",
          active ? "bg-forest-600 text-leaf-200" : "bg-cream-200 text-ink-600",
        )}
      >
        <span className="sr-only">(</span>
        {count}
        <span className="sr-only"> lugares)</span>
      </span>
    </button>
  );
}
