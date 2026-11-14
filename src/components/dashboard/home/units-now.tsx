import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { UNIT_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

/*
 * Las unidades en una sola barra. Antes eran cuatro tarjetas de una fila
 * entera ("3 de 73", "63 de 73"…): mucho espacio para cuatro números que se
 * entienden mejor juntos, como partes de un todo.
 */

const ORDER = ["ocupado", "limpieza", "mantenimiento", "disponible"] as const;

export function UnitsNowCard({
  totals,
  occupancy30d,
  href,
  className,
}: {
  totals: { units: number; available_units: number; occupied_units: number; cleaning_units: number; maintenance_units: number };
  occupancy30d: number;
  href: string;
  className?: string;
}) {
  const counts: Record<(typeof ORDER)[number], number> = {
    ocupado: totals.occupied_units,
    limpieza: totals.cleaning_units,
    mantenimiento: totals.maintenance_units,
    disponible: totals.available_units,
  };
  const sum = ORDER.reduce((acc, k) => acc + counts[k], 0) || 1;

  return (
    <section className={cn("@container rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Unidades ahora</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Calendario <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{totals.occupied_units}</span>
        <span className="text-[13px] text-muted-foreground">
          de {totals.units} {totals.units === 1 ? "ocupada" : "ocupadas"}
        </span>
      </div>

      <div className="mt-4 flex h-2.5 gap-[3px] overflow-hidden rounded-full" role="img" aria-label="Estado de las unidades">
        {ORDER.filter((k) => counts[k] > 0).map((k) => (
          <span
            key={k}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(counts[k] / sum) * 100}%`, backgroundColor: UNIT_STATUS_META[k].color }}
          />
        ))}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] @lg:grid-cols-4">
        {ORDER.map((k) => (
          <li key={k} className={cn("flex items-center gap-2", counts[k] === 0 && "opacity-50")}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: UNIT_STATUS_META[k].color }} aria-hidden />
            <span className="truncate text-muted-foreground">{UNIT_STATUS_META[k].label}</span>
            <span className="ml-auto font-semibold tabular-nums">{counts[k]}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/70 pt-4">
        <span className="text-[13px] text-muted-foreground">Ocupación, últimos 30 días</span>
        <span className="text-[15px] font-semibold tabular-nums">
          {occupancy30d.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %
        </span>
      </div>
    </section>
  );
}
