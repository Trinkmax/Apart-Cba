import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AggregateView, ResultsMode } from "@/lib/finance/results-issues";
import { RESULTS_MODE_META, RESULTS_MODE_ORDER, resultsHref } from "./results-meta";

/**
 * Control segmentado hecho de links (server component). Cada opción es una
 * URL, así el estado se comparte, el "atrás" funciona y no hace falta JS.
 * `scroll={false}`: cambiar de opción no tira la página arriba de todo.
 */
export function SegmentedNav({
  label,
  items,
  className,
}: {
  label: string;
  items: Array<{ key: string; label: string; href: string; active: boolean }>;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-lg border bg-card p-1", className)}>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          scroll={false}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 sm:px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            it.active
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Todos · Temporarios · Mensuales" (`?modo=`). Conserva la vista de la tabla. */
export function ResultsModeNav({
  year,
  month,
  mode,
  vista,
}: {
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
}) {
  return (
    <SegmentedNav
      label="Tipo de reserva"
      items={RESULTS_MODE_ORDER.map((m) => ({
        key: m,
        label: RESULTS_MODE_META[m].label,
        href: resultsHref(year, month, { modo: m, vista }),
        active: m === mode,
      }))}
    />
  );
}
