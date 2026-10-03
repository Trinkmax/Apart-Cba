import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ADJUSTMENT_STATUS_META } from "@/lib/rentals/labels";
import { DateTile, Money } from "@/components/rentals/ui";
import { formatVariation, waitingForIndexText } from "@/components/rentals/adjustments/adjustment-text";
import { IndexCard } from "@/components/rentals/indices/index-cards";
import type { IndexSummary } from "@/components/rentals/indices/index-model";
import type { ExpiringContractRow, UpcomingAdjustmentRow } from "./dashboard-types";

/** Columna lateral del resumen: próximos ajustes, contratos por vencer e índices. */

function PanelHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {linkLabel} <ArrowRight size={11} />
      </Link>
    </div>
  );
}

/**
 * `indices` (los mismos resúmenes de la columna) y `fromKey` dejan nombrar el
 * mes de Casa Propia que de verdad falta; sin ellos se nombra el final de la ventana.
 */
export function UpcomingAdjustmentsPanel({
  rows,
  today,
  indices,
}: {
  rows: (UpcomingAdjustmentRow & { fromKey?: string | null })[];
  today: string;
  indices?: IndexSummary[];
}) {
  // undefined (no null) cuando no hay resumen de ese índice: null es "no hay nada cargado".
  const coverageOf = (code: string | null) => indices?.find((s) => s.code === code)?.coverage;
  return (
    <Card className="gap-0 p-0 overflow-hidden">
      <PanelHeader title="Próximos ajustes" href="/dashboard/alquileres/ajustes" linkLabel="Ver todos" />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay ajustes en los próximos 60 días.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((a) => {
            const meta = ADJUSTMENT_STATUS_META[a.status as keyof typeof ADJUSTMENT_STATUS_META];
            return (
              <li key={a.id}>
                <Link href={`/dashboard/alquileres/ajustes?tab=proximos#ajuste-${a.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                  <DateTile date={a.effectiveDate} tone={a.status === "aplicado" ? "in" : a.effectiveDate <= today ? "warn" : "neutral"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.address}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.tenantName ?? "Sin inquilino cargado"}</p>
                    {a.newAmount != null ? (
                      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                        {a.baseAmount != null && <Money amount={a.baseAmount} currency={a.currency} tone="muted" />}
                        <span className="text-muted-foreground">→</span>
                        <Money amount={a.newAmount} currency={a.currency} className="font-semibold" />
                        {a.variationPct != null && <span className="text-muted-foreground">{formatVariation(a.variationPct)}</span>}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {a.status === "pendiente_manual"
                          ? "Falta cargar el monto"
                          : waitingForIndexText(a.indexCode, a.toKey, { coverage: coverageOf(a.indexCode), fromKey: a.fromKey })}
                      </p>
                    )}
                    {meta && a.status !== "programado" && (
                      <p className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: meta.color }}>
                        <span className="status-dot" style={{ backgroundColor: meta.color }} /> {meta.label}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function ExpiringPanel({ rows }: { rows: ExpiringContractRow[] }) {
  return (
    <Card className="gap-0 p-0 overflow-hidden">
      <PanelHeader title="Vencimientos" href="/dashboard/alquileres/contratos" linkLabel="Contratos" />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ningún contrato vence en los próximos 90 días.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((c) => {
            const tone = c.daysLeft < 0 ? "out" : c.daysLeft <= 30 ? "warn" : "neutral";
            return (
              <li key={c.contractId}>
                <Link href={`/dashboard/alquileres/contratos/${c.contractId}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                  <DateTile date={c.endDate} tone={tone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.address}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.tenantName ?? "Sin inquilino cargado"}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      c.daysLeft < 0
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : c.daysLeft <= 30
                          ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {c.daysLeft < 0 ? "Vencido" : c.daysLeft === 0 ? "Hoy" : `${c.daysLeft} días`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function IndicesPanel({ indices, inUse }: { indices: IndexSummary[]; inUse?: string[] }) {
  if (!indices.length) return null;
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Índices al día</h2>
        <Link href="/dashboard/alquileres/ajustes#indices" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Calculadora <ArrowRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {indices.map((s) => (
          <IndexCard key={s.code} s={s} compact inUse={inUse?.includes(s.code)} />
        ))}
      </div>
    </section>
  );
}
