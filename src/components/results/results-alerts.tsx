import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Percent, Users, UserX } from "lucide-react";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import type { MonthlyResults } from "@/lib/actions/results";

/**
 * Avisos que explican por qué el resultado puede estar incompleto. Cada uno
 * lleva al lugar donde se arregla: el número sin contexto no sirve.
 */
export function ResultsAlerts({ results }: { results: MonthlyResults }) {
  const items: Array<{
    key: string;
    tone: "amber" | "slate";
    icon: ReactNode;
    text: string;
    href: string;
    cta: string;
  }> = [];

  if (results.missing_price_count > 0) {
    const n = results.missing_price_count;
    items.push({
      key: "price",
      tone: "amber",
      icon: <AlertTriangle size={16} />,
      text:
        n === 1
          ? "1 reserva sin importe cargado: el resultado está incompleto"
          : `${n} reservas sin importe cargado: el resultado está incompleto`,
      href: "/dashboard/unidades/kanban?completar=1",
      cta: "Cargar importes",
    });
  }

  for (const source of results.channels_without_pct) {
    items.push({
      key: `pct-${source}`,
      tone: "amber",
      icon: <Percent size={16} />,
      text: `No configuraste la comisión de ${BOOKING_SOURCE_META[source]?.label ?? source}: se está contando 0%`,
      href: "/dashboard/configuracion/comisiones",
      cta: "Configurar",
    });
  }

  for (const u of results.units_bad_shares) {
    items.push({
      key: `shares-${u.unit_id}`,
      tone: "amber",
      icon: <Users size={16} />,
      // La proyección normaliza estas participaciones; la liquidación no. Con
      // dos dueños al 100% cada uno, el depto aparece con el doble de ingreso.
      text: `Las participaciones de ${u.code} suman ${u.total_pct}%, no 100%: sus números por departamento pueden salir duplicados`,
      href: `/dashboard/unidades/${u.unit_id}`,
      cta: "Corregir",
    });
  }

  if (results.units_without_owner.length > 0) {
    items.push({
      key: "owners",
      tone: "slate",
      icon: <UserX size={16} />,
      text: `Unidades sin propietario: ${results.units_without_owner.map((u) => u.code).join(", ")}`,
      href: "/dashboard/propietarios",
      cta: "Ver propietarios",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={
            it.tone === "amber"
              ? "flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors text-amber-800 dark:text-amber-200"
              : "flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 border hover:border-foreground/20 transition-colors text-foreground"
          }
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className={it.tone === "amber" ? "text-amber-600 dark:text-amber-400 shrink-0" : "text-muted-foreground shrink-0"}>
              {it.icon}
            </span>
            <span className="text-sm leading-snug">{it.text}</span>
          </span>
          <span className="text-xs shrink-0 flex items-center gap-1 opacity-80">
            {it.cta} <ArrowRight size={12} />
          </span>
        </Link>
      ))}
    </div>
  );
}
