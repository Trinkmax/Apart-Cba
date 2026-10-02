import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight, ClipboardList, FileClock, HandCoins, RefreshCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StackedBar } from "@/components/rentals/ui";
import { monthLabelOf } from "@/lib/rentals/labels";
import { addMonthsToMonth, monthOf } from "@/lib/rentals/ymd";
import { cn } from "@/lib/utils";
import { relativeMonthLabel } from "@/components/rentals/collections/board-helpers";
import { monthInSentence } from "./proof-helpers";
import type { ProofsKpi } from "./proof-types";

/**
 * Encabezado numérico de Comprobantes y el ← mes → (links puros: cada mes es
 * una URL que se puede compartir). Server-safe.
 */

function hrefFor(month: string, tab?: string): string {
  const qs = new URLSearchParams({ mes: month.slice(0, 7) });
  if (tab) qs.set("tab", tab);
  return `/dashboard/alquileres/comprobantes?${qs.toString()}`;
}

export function ProofsMonthNav({ month, today, tab }: { month: string; today: string; tab?: string }) {
  const current = monthOf(today);
  const isCurrent = month === current;
  const relative = relativeMonthLabel(month, current);
  const iconBtn = cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7");
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
      <Link href={hrefFor(addMonthsToMonth(month, -1), tab)} aria-label="Mes anterior" className={iconBtn} scroll={false}>
        <ChevronLeft className="size-4" />
      </Link>
      <div className="min-w-[120px] px-2 text-center">
        {relative && <div className="text-[10px] font-bold uppercase leading-none tracking-wide text-muted-foreground">{relative}</div>}
        <div className={cn("text-xs font-semibold leading-tight", relative && "mt-0.5")}>{monthLabelOf(month)}</div>
      </div>
      <Link
        href={hrefFor(addMonthsToMonth(month, 1), tab)}
        aria-label="Mes siguiente"
        className={cn(iconBtn, month >= current && "pointer-events-none opacity-40")}
        aria-disabled={month >= current}
        tabIndex={month >= current ? -1 : undefined}
        scroll={false}
      >
        <ChevronRight className="size-4" />
      </Link>
      {!isCurrent && (
        <Link href={hrefFor(current, tab)} aria-label="Volver a este mes" title="Volver a este mes" className={iconBtn} scroll={false}>
          <RefreshCcw className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  children,
}: {
  icon: typeof Building2;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "in" | "warn" | "blue";
  children?: React.ReactNode;
}) {
  return (
    <Card className="h-full gap-0 p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl",
          tone === "in" && "text-emerald-700 dark:text-emerald-400",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
          tone === "blue" && "text-blue-700 dark:text-blue-300",
        )}
      >
        {value}
      </div>
      {children}
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function ProofsKpis({ kpi, reviewCount, reportsCount }: { kpi: ProofsKpi; reviewCount: number; reportsCount: number }) {
  const missingExpensas = Math.max(0, kpi.expensasRequired - kpi.expensasValidated - kpi.expensasInReview);
  const allOk = kpi.expensasRequired > 0 && kpi.expensasValidated === kpi.expensasRequired;
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <Tile
        icon={Building2}
        label="Expensas al día"
        tone={allOk ? "in" : undefined}
        value={
          kpi.expensasRequired ? (
            <>
              {kpi.expensasValidated} <span className="text-sm font-normal text-muted-foreground sm:text-base">de {kpi.expensasRequired}</span>
            </>
          ) : (
            "—"
          )
        }
        hint={
          kpi.expensasRequired
            ? `contratos de ${monthInSentence(kpi.month)}${kpi.expensasInReview ? ` · ${kpi.expensasInReview} en revisión` : ""}`
            : "Ningún contrato pide expensas este mes"
        }
      >
        {kpi.expensasRequired > 0 && (
          <StackedBar
            className="mt-2 h-1.5"
            segments={[
              { label: "Validadas", value: kpi.expensasValidated, color: "#10b981" },
              { label: "En revisión", value: kpi.expensasInReview, color: "#3b82f6" },
              { label: "Faltan", value: missingExpensas, color: "#f59e0b" },
            ]}
          />
        )}
      </Tile>
      <Tile icon={FileClock} label="Para revisar" tone={reviewCount ? "blue" : undefined} value={reviewCount} hint={reviewCount ? "comprobantes subidos" : "Nada pendiente"} />
      <Tile
        icon={ClipboardList}
        label="Faltan"
        tone={kpi.missingCount ? "warn" : "in"}
        value={kpi.missingCount}
        hint={kpi.missingCount ? `en ${kpi.contractsWithMissing} ${kpi.contractsWithMissing === 1 ? "contrato" : "contratos"}` : "Todo presentado"}
      />
      <Tile icon={HandCoins} label="Avisos de pago" tone={reportsCount ? "blue" : undefined} value={reportsCount} hint={reportsCount ? "para registrar o descartar" : "Ninguno nuevo"} />
    </div>
  );
}
