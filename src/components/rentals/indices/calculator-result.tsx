import { ChevronDown, CircleDashed, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Money } from "@/components/rentals/ui";
import {
  adjustmentWindowLabel,
  formatVariation,
  longDate,
  monthName,
  shortDate,
  waitingForIndexText,
} from "@/components/rentals/adjustments/adjustment-text";
import { INDEX_META, indexFrequency, isCoefficientIndex } from "@/lib/rentals/indices";
import { addMonthsToMonth } from "@/lib/rentals/ymd";
import type { CalculatorInput, CalculatorResult } from "./calculator-model";

const LEVEL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

/** Resultado de la calculadora: el precio de hoy, el próximo ajuste y la cadena paso a paso. */
export function CalculatorResultView({ input, result, currency = "ARS" }: { input: CalculatorInput; result: CalculatorResult; currency?: string }) {
  const { steps, currentAmount, pendingNow, next, totalVariationPct } = result;
  const started = steps.some((s) => s.inForce);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {started ? "Hoy debería pagar" : "Paga hoy"}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Money amount={currentAmount} currency={currency} className="text-3xl font-bold tracking-tight" />
          {totalVariationPct != null && totalVariationPct !== 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatVariation(totalVariationPct)} desde el {shortDate(input.startDate)}
            </span>
          )}
        </div>
        {pendingNow && (
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
            Provisorio: el ajuste del {shortDate(pendingNow.effectiveDate)} ya rige pero falta el índice.{" "}
            {waitingForIndexText(input.indexCode, pendingNow.missing[pendingNow.missing.length - 1] ?? pendingNow.toKey)}
          </p>
        )}
        {next && !pendingNow && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Próximo ajuste: {longDate(next.effectiveDate)}
            {next.amount != null ? (
              <>
                {" "}→ <Money amount={next.amount} currency={currency} className="font-medium text-foreground" /> ({formatVariation(next.variationPct)}).
              </>
            ) : next.status === "pendiente_indice" ? (
              <> · {waitingForIndexText(input.indexCode, next.missing[next.missing.length - 1] ?? next.toKey)}</>
            ) : (
              "."
            )}
          </p>
        )}
      </div>

      {steps.length > 0 && (
        <ol className="relative ml-1.5 space-y-2.5 border-l border-border/70 pl-4">
          {steps.map((s) => {
            const win = adjustmentWindowLabel({ method: "indice", index_code: input.indexCode, from_key: s.fromKey, to_key: s.toKey });
            const known = s.amount != null;
            return (
              <li key={s.sequence} className="relative">
                <span
                  className={cn(
                    "absolute -left-[23px] top-0.5 flex size-3.5 items-center justify-center rounded-full bg-background",
                    known ? (s.inForce ? "text-[#0d9488]" : "text-foreground") : "text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {known ? <CircleDot size={14} /> : <CircleDashed size={14} />}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-xs font-medium">{shortDate(s.effectiveDate)}</span>
                  {known ? (
                    <span className="text-sm font-semibold tabular-nums">
                      <Money amount={s.amount} currency={currency} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{s.status === "bloqueado" ? "después del anterior" : "sin índice todavía"}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {known ? `${formatVariation(s.variationPct)}${win ? ` · ${win}` : ""}${s.capped ? " · con tope" : ""}${s.floored ? " · el índice bajó, el precio no" : ""}` : win ?? ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {steps.some((s) => s.fromValue != null && s.toValue != null) && (
        <details className="group rounded-lg border bg-card/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Ver los valores del índice
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="space-y-1.5 px-3 pb-3 text-[11px]">
            {steps
              .filter((s) => s.fromValue != null && s.toValue != null)
              .map((s) => (
                <li key={s.sequence} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-muted-foreground">
                    {shortDate(s.effectiveDate)} · {INDEX_META[input.indexCode].label}{" "}
                    {/* Casa Propia: los "niveles" son coeficientes encadenados en memoria; lo que se publica es cada mes. */}
                    {isCoefficientIndex(input.indexCode) && s.fromKey && s.toKey
                      ? `${monthName(addMonthsToMonth(s.fromKey, 1), true)} a ${monthName(s.toKey, true)}`
                      : `${LEVEL.format(s.toValue!)} ÷ ${LEVEL.format(s.fromValue!)}`}
                  </span>
                  <span className="font-medium tabular-nums">× {LEVEL.format(s.coefficient ?? s.toValue! / s.fromValue!)}</span>
                </li>
              ))}
            <li className="pt-1 text-muted-foreground">
              {isCoefficientIndex(input.indexCode)
                ? `Producto de los coeficientes mensuales de cada ventana. Fuente: ${INDEX_META[input.indexCode].publisher}.`
                : indexFrequency(input.indexCode) === "monthly"
                ? `Nivel del índice del último mes de cada ventana dividido por el del mes base. Fuente: ${INDEX_META[input.indexCode].publisher}.`
                : `Valor del día del ajuste dividido por el del día de inicio del ciclo. Fuente: ${INDEX_META[input.indexCode].publisher}.`}
            </li>
          </ul>
        </details>
      )}
    </div>
  );
}
