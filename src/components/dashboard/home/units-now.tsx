import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { UNIT_STATUS_META } from "@/lib/constants";
import { donutSegments, gapForPixels } from "@/lib/dashboard/donut";
import type { UnitStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

/*
 * Las unidades ahora, en una torta (lo pidió el dueño, 14/11/2026: la barra
 * dejaba la tarjeta medio vacía). La torta crece con el alto de la fila, así la
 * tarjeta nunca queda con un hueco abajo; los números exactos van al lado.
 *
 * Los colores son los de cada estado en todo el sistema, con un paso más oscuro
 * donde hacía falta para que dos partes vecinas se distingan (validado con el
 * script de dataviz, también para daltonismo y en oscuro):
 * - Disponible va un paso más oscuro (esmeralda 600): el 500 se confundía con el
 *   celeste de Limpieza cuando Mantenimiento está en cero y quedan pegados.
 * - En oscuro, todos un paso más oscuros: los 500 encandilaban sobre el fondo.
 * - El orden de la vuelta separa Reservado (ámbar) de Mantenimiento (naranja),
 *   que juntos no se distinguen.
 */

const PARTS: { key: UnitStatus; stroke: string; dot: string }[] = [
  { key: "ocupado", stroke: "stroke-[#3b82f6] dark:stroke-[#2563eb]", dot: "bg-[#3b82f6] dark:bg-[#2563eb]" },
  { key: "mantenimiento", stroke: "stroke-[#f97316] dark:stroke-[#ea580c]", dot: "bg-[#f97316] dark:bg-[#ea580c]" },
  { key: "limpieza", stroke: "stroke-[#06b6d4] dark:stroke-[#0891b2]", dot: "bg-[#06b6d4] dark:bg-[#0891b2]" },
  { key: "disponible", stroke: "stroke-[#059669] dark:stroke-[#16a34a]", dot: "bg-[#059669] dark:bg-[#16a34a]" },
  { key: "reservado", stroke: "stroke-[#f59e0b] dark:stroke-[#d97706]", dot: "bg-[#f59e0b] dark:bg-[#d97706]" },
  { key: "bloqueado", stroke: "stroke-[#94a3b8] dark:stroke-[#64748b]", dot: "bg-[#94a3b8] dark:bg-[#64748b]" },
];

/** Siempre en la leyenda, aunque estén en cero; Reservado y Bloqueado sólo si hay. */
const ALWAYS: UnitStatus[] = ["ocupado", "mantenimiento", "limpieza", "disponible"];

// 2 px de hueco con la torta en su tamaño mínimo (160 px).
const GAP = gapForPixels(2, 160);

export interface UnitTotals {
  units: number;
  available_units: number;
  occupied_units: number;
  cleaning_units: number;
  maintenance_units: number;
  reserved_units: number;
  blocked_units: number;
}

export function UnitsNowCard({
  totals,
  occupancy30d,
  href,
  className,
}: {
  totals: UnitTotals;
  occupancy30d: number;
  href: string;
  className?: string;
}) {
  const counts: Partial<Record<UnitStatus, number>> = {
    ocupado: totals.occupied_units,
    mantenimiento: totals.maintenance_units,
    limpieza: totals.cleaning_units,
    disponible: totals.available_units,
    reservado: totals.reserved_units,
    bloqueado: totals.blocked_units,
  };
  const parts = PARTS.map((p) => ({ ...p, count: counts[p.key] ?? 0, label: UNIT_STATUS_META[p.key].label }));
  const byKey = new Map(parts.map((p) => [p.key as string, p]));
  const segments = donutSegments(parts.map((p) => ({ key: p.key, value: p.count })), { gap: GAP });
  const legend = parts.filter((p) => ALWAYS.includes(p.key) || p.count > 0);
  const percent = (n: number) => (totals.units > 0 ? Math.round((n / totals.units) * 100) : 0);
  const summary = legend.map((p) => `${p.label}: ${p.count}`).join(", ");

  return (
    <section
      className={cn(
        "@container flex flex-col rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Unidades ahora</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Calendario <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-5 @md:flex-row @md:items-center @md:gap-7">
        {/* La torta llena el alto que le sobra a la tarjeta (la fila la marca «Para atender»). */}
        <div className="relative min-h-40 w-full flex-1 @md:min-h-48 @md:max-w-64">
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 size-full"
            role="img"
            aria-label={`${totals.occupied_units} de ${totals.units} unidades ocupadas. ${summary}.`}
          >
            {segments.length === 0 ? (
              <circle cx="50" cy="50" r="40" fill="none" strokeWidth="11" className="stroke-muted" />
            ) : (
              segments.map((s) => {
                const part = byKey.get(s.key);
                if (!part) return null;
                return (
                  <circle
                    key={s.key}
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    strokeWidth="11"
                    pathLength={1000}
                    strokeDasharray={s.dashArray}
                    strokeDashoffset={s.dashOffset}
                    transform="rotate(-90 50 50)"
                    className={cn(part.stroke, "transition-opacity hover:opacity-80")}
                  >
                    <title>{`${part.label}: ${s.value} (${percent(s.value)} %)`}</title>
                  </circle>
                );
              })
            )}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{totals.occupied_units}</span>
            <span className="mt-1 text-[12px] text-muted-foreground">
              de {totals.units} {totals.units === 1 ? "ocupada" : "ocupadas"}
            </span>
          </div>
        </div>

        {/* Centrada debajo de la torta: con cinco estados el último no deja un hueco. Al costado, en lista. */}
        <ul className="flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-2 text-[13px] @md:min-w-40 @md:flex-col @md:flex-nowrap @md:gap-y-3">
          {legend.map((p) => (
            <li key={p.key} className={cn("flex items-center gap-1.5", p.count === 0 && "opacity-50")}>
              <span className={cn("size-2.5 shrink-0 rounded-full", p.dot)} aria-hidden />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="pl-0.5 font-semibold tabular-nums @md:ml-auto @md:pl-3">{p.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/70 pt-4">
        <span className="text-[13px] text-muted-foreground">Ocupación, últimos 30 días</span>
        <span className="text-[15px] font-semibold tabular-nums">
          {occupancy30d.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %
        </span>
      </div>
    </section>
  );
}
