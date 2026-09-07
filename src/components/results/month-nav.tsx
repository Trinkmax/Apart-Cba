import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatPeriod } from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
import { resultsHref, shiftMonth } from "./results-meta";

/**
 * ← Mes → de Resultados. Son links puros (server component): cada mes es una
 * URL con ?year&month, así se puede compartir y el botón "atrás" funciona.
 * Misma silueta que el DateNav del parte diario.
 */
export function MonthNav({
  year,
  month,
  todayYear,
  todayMonth,
}: {
  year: number;
  month: number;
  todayYear: number;
  todayMonth: number;
}) {
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const cursor = year * 12 + month;
  const todayCursor = todayYear * 12 + todayMonth;
  const isCurrent = cursor === todayCursor;
  const relativeLabel = isCurrent ? "Este mes" : cursor < todayCursor ? "Mes cerrado" : "Próximo";
  const iconBtn = cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7");

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <Link href={resultsHref(prev.year, prev.month)} aria-label="Mes anterior" className={iconBtn}>
        <ChevronLeft className="size-4" />
      </Link>
      <div className="px-2 min-w-[132px] text-center">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-none">
          {relativeLabel}
        </div>
        <div className="text-xs font-semibold leading-tight mt-0.5">{formatPeriod(year, month)}</div>
      </div>
      <Link href={resultsHref(next.year, next.month)} aria-label="Mes siguiente" className={iconBtn}>
        <ChevronRight className="size-4" />
      </Link>
      {!isCurrent && (
        <Link
          href={resultsHref(todayYear, todayMonth)}
          aria-label="Volver a este mes"
          title="Volver a este mes"
          className={iconBtn}
        >
          <RefreshCcw className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
