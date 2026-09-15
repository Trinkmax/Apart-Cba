import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  REVIEW_EXTRA_META,
  REVIEW_WHERE_LABEL,
  type AggregateView,
  type ResultsMode,
} from "@/lib/finance/results-issues";
import type { ReviewItem } from "@/lib/finance/results-reconciliation";
import { resultsHref } from "./results-meta";

/** Cuántos ítems se ven sin desplegar. */
const VISIBLE_ITEMS = 3;

/**
 * "Para revisar": datos rotos, filas que faltan en la liquidación y saldos a
 * cobrar. Lo que tiene un error no entra en la diferencia de tarifa; las
 * liquidadas con saldo del huésped sí (el saldo es cobranza, no un error de la
 * liquidación). Agrupado por DÓNDE se arregla (la reserva,
 * la liquidación, la unidad, la configuración), para que cada persona vaya
 * directo a lo suyo. Dentro de cada lugar, el mayor monto en juego primero
 * (el orden ya viene resuelto de buildReviewItems).
 *
 * Server component: el "Ver más" es un <details>, sin JS.
 */
export function ResultsReviewPanel({
  review,
  year,
  month,
  mode,
  vista,
}: {
  review: ReviewItem[];
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
}) {
  if (review.length === 0) return null;

  // El encabezado del lugar se repite sólo cuando cambia: si el despliegue
  // continúa un grupo que ya empezó arriba, no se vuelve a titular.
  const entries = review.map((item, i) => ({
    item,
    header: i === 0 || review[i - 1].where !== item.where,
  }));
  const visible = entries.slice(0, VISIBLE_ITEMS);
  const hidden = entries.slice(VISIBLE_ITEMS);
  const ctx = { year, month, mode, vista };

  return (
    <section aria-labelledby="para-revisar-title" className="rounded-xl border bg-card overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b px-4 py-3">
        <h2 id="para-revisar-title" className="flex items-center gap-2 text-sm font-semibold">
          <TriangleAlert className="size-4 text-amber-500" aria-hidden />
          Para revisar
        </h2>
        <p className="text-xs text-muted-foreground">
          Datos rotos, filas que faltan o saldos a cobrar. Lo que tiene un error no entra en la diferencia de tarifa.
        </p>
      </header>

      <ul>
        {visible.map(({ item, header }) => (
          <ReviewEntry key={item.id} item={item} header={header} {...ctx} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver {hidden.length} más</span>
            <span className="hidden group-open:inline">Ver menos</span>
          </summary>
          <ul>
            {hidden.map(({ item, header }) => (
              <ReviewEntry key={item.id} item={item} header={header} {...ctx} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ReviewEntry({
  item,
  header,
  year,
  month,
  mode,
  vista,
}: {
  item: ReviewItem;
  header: boolean;
  year: number;
  month: number;
  mode: ResultsMode;
  vista: AggregateView;
}) {
  const action = actionOf(item, { year, month, mode, vista });
  const atStake = item.at_stake.filter((a) => Math.abs(a.amount) > 0);

  return (
    <li>
      {header && (
        <div className="px-4 pt-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {REVIEW_WHERE_LABEL[item.where]}
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/30">
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          <p className="text-sm leading-snug">
            {item.label}{" "}
            <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-800 dark:text-amber-200">
              {item.count}
            </span>
          </p>
          {atStake.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums sm:mt-0 sm:ml-auto sm:text-right">
              en juego{" "}
              {atStake.map((a, i) => (
                <span key={a.currency} className="whitespace-nowrap">
                  {i > 0 && " + "}
                  <span className="font-semibold text-foreground">{formatMoney(a.amount, a.currency)}</span>
                </span>
              ))}
            </p>
          )}
        </div>
        {action && (
          <Link
            href={action.href}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 shrink-0 gap-1 px-2.5 text-xs")}
          >
            {action.label}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}

function actionOf(
  item: ReviewItem,
  { year, month, mode, vista }: { year: number; month: number; mode: ResultsMode; vista: AggregateView },
): { href: string; label: string } | null {
  if (item.filter) {
    return { href: resultsHref(year, month, { modo: mode, vista, filtro: item.filter }), label: "Ver reservas" };
  }
  if (item.id === "sin_reserva") {
    return {
      href: resultsHref(year, month, { modo: mode, vista, tab: "huerfanas" }),
      label: REVIEW_EXTRA_META.sin_reserva.cta,
    };
  }
  if (item.href) return { href: item.href, label: "Configurar comisiones" };
  return null;
}
