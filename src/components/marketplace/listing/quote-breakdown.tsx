"use client";

import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { monthsLabel, nightsLabel, type StayEvaluation } from "@/lib/marketplace/widget-quote";

function Row({ label, value, strong, className }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn("min-w-0", strong ? "font-bold text-forest-700" : "text-ink-700")}>{label}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong ? "text-lg font-extrabold text-forest-700" : "text-ink-900")}>{value}</dd>
    </div>
  );
}

/**
 * Desglose de la cotización del widget.
 * - Por noche: "$X × N noches", limpieza, Total, seña para confirmar y lo que
 *   se paga al llegar.
 * - Por mes: precio mensual de lista (o "a consultar") y el estimado.
 */
export function QuoteBreakdown({
  evaluation,
  currency,
  instant,
  months,
  className,
}: {
  evaluation: StayEvaluation;
  currency: string;
  instant: boolean;
  /** Meses elegidos en la vista por mes (para el rótulo del estimado). */
  months?: number | null;
  className?: string;
}) {
  const fmt = (n: number) => formatCurrency(n, currency);

  if (evaluation.kind === "nightly") {
    const perNight = evaluation.nights > 0 ? evaluation.subtotal / evaluation.nights : 0;
    return (
      <div className={cn("space-y-3", className)}>
        <dl className="space-y-2 text-[0.9375rem]">
          <Row label={`${fmt(perNight)} × ${nightsLabel(evaluation.nights)}`} value={fmt(evaluation.subtotal)} />
          {evaluation.cleaningFee > 0 ? <Row label="Limpieza" value={fmt(evaluation.cleaningFee)} /> : null}
          <Row label="Total" value={fmt(evaluation.total)} strong className="border-t border-cream-300 pt-2.5" />
        </dl>
        <dl className="space-y-1.5 rounded-2xl bg-leaf-100 px-4 py-3 text-[0.875rem]">
          {evaluation.sena != null ? (
            <>
              <Row
                label={
                  <span className="text-forest-700">
                    {instant ? "Seña para asegurarla" : "Seña para confirmar"}
                    {evaluation.senaRule ? <span className="text-ink-500"> ({evaluation.senaRule})</span> : null}
                  </span>
                }
                value={<span className="font-bold text-forest-700">{fmt(evaluation.sena)}</span>}
              />
              <Row label={<span className="text-forest-700">Al llegar</span>} value={fmt(evaluation.resto)} />
            </>
          ) : (
            <Row label={<span className="text-forest-700">Sin seña: pagás todo al llegar</span>} value={fmt(evaluation.resto)} />
          )}
        </dl>
      </div>
    );
  }

  if (evaluation.kind === "monthly") {
    return (
      <div className={cn("space-y-2 text-[0.9375rem]", className)}>
        <dl className="space-y-2">
          <Row
            label="Precio por mes"
            value={evaluation.monthlyPrice != null ? fmt(evaluation.monthlyPrice) : <span className="font-semibold text-forest-700">A consultar</span>}
          />
          {evaluation.estimatedTotal != null && evaluation.nights ? (
            <Row
              label={`Estimado ${months ? `por ${monthsLabel(months)}` : ""} (${nightsLabel(evaluation.nights)})`.replace("  ", " ")}
              value={fmt(evaluation.estimatedTotal)}
              strong
              className="border-t border-cream-300 pt-2.5"
            />
          ) : null}
        </dl>
        <p className="text-[0.8125rem] leading-relaxed text-ink-500">
          Las estadías por mes se consultan: te pasamos el precio final, el contrato y la forma de pago por WhatsApp o mail.
        </p>
      </div>
    );
  }

  return null;
}
