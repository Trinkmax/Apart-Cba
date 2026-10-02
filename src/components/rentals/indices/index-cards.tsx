import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { addMonthsToMonth } from "@/lib/rentals/ymd";
import { RENTALS_ACCENT } from "@/components/rentals/ui";
import { formatVariation, monthName, shortDate } from "@/components/rentals/adjustments/adjustment-text";
import type { IndexSummary, MonthlyVariation } from "./index-model";

/**
 * Tarjetas de índices (IPC, ICL, Casa Propia…): último dato, variación del
 * mes, de 3 y 12 meses, minigráfico de las variaciones mensuales (CSS, sin
 * librerías) y si está al día. Server-safe.
 */

const LEVEL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Barras de las variaciones mensuales; la última resaltada. */
export function MonthlyBars({ data, className }: { data: MonthlyVariation[]; className?: string }) {
  if (data.length < 2) return <div className={cn("h-10", className)} aria-hidden />;
  const max = Math.max(...data.map((d) => Math.abs(d.pct)), 0.0001);
  return (
    <div
      className={cn("flex h-10 items-end gap-[3px]", className)}
      role="img"
      aria-label={`Variación mensual de los últimos ${data.length} meses: ${data.map((d) => `${monthName(d.month)} ${formatVariation(d.pct)}`).join(", ")}`}
    >
      {data.map((d, i) => {
        const last = i === data.length - 1;
        return (
          <div
            key={d.month}
            title={`${capitalize(monthName(d.month, true))}: ${formatVariation(d.pct)}`}
            className="flex-1 rounded-t-[3px] transition-opacity hover:opacity-100"
            style={{
              height: `${Math.max(8, (Math.abs(d.pct) / max) * 100)}%`,
              backgroundColor: d.pct < 0 ? "#f43f5e" : RENTALS_ACCENT,
              opacity: last ? 1 : 0.35,
            }}
          />
        );
      })}
    </div>
  );
}

function freshnessText(s: IndexSummary): string {
  if (s.freshness === "empty") return s.code === "casa_propia" ? "Se carga a mano cuando sale" : "Sin datos todavía";
  if (s.frequency === "daily") {
    return s.lastPublished && s.refDate && s.lastPublished > s.refDate
      ? `Publicado hasta el ${shortDate(s.lastPublished)}`
      : `Último dato: ${shortDate(s.lastPublished ?? "")}`;
  }
  const next = addMonthsToMonth(s.refDate!, 1);
  if (s.freshness === "late") return `Atrasado: el último es de ${monthName(s.refDate!)}`;
  if (s.code === "ipc") return `El de ${monthName(next)} sale a mediados de ${monthName(addMonthsToMonth(next, 1))}`;
  return `Próximo: ${monthName(next)}`;
}

export function IndexCard({ s, inUse, compact }: { s: IndexSummary; inUse?: boolean; compact?: boolean }) {
  const dot = s.freshness === "ok" ? "bg-emerald-500" : s.freshness === "late" ? "bg-amber-500" : "bg-muted-foreground/40";
  const headline = s.monthlyPct;
  return (
    <Card className={cn("gap-0 p-3.5 sm:p-4 min-w-0", s.freshness === "empty" && "border-dashed")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none">{s.label}</p>
          <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">{s.publisher}</p>
        </div>
        {inUse && (
          <span
            className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}12`, borderColor: `${RENTALS_ACCENT}35` }}
          >
            {compact ? "En uso" : "En tus contratos"}
          </span>
        )}
      </div>

      {s.freshness === "empty" ? (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          {s.code === "casa_propia"
            ? "No tiene una fuente automática: lo carga el equipo de la plataforma cuando el Ministerio lo publica."
            : "Todavía no llegaron datos. Se actualizan solos todas las noches."}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: headline != null && headline < 0 ? "#e11d48" : undefined }}>
              {formatVariation(headline)}
            </p>
            <p className="text-[11px] text-muted-foreground text-right leading-tight">
              {s.frequency === "monthly" ? capitalize(monthName(s.refDate!, true)) : "últimos 30 días"}
            </p>
          </div>
          {!compact && <MonthlyBars data={s.monthly} className="mt-2.5" />}
          <dl className="mt-2.5 grid grid-cols-2 gap-x-3 text-[11px]">
            <div>
              <dt className="text-muted-foreground">{s.frequency === "monthly" ? "3 meses" : "90 días"}</dt>
              <dd className="font-medium tabular-nums">{formatVariation(s.quarterPct)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">12 meses</dt>
              <dd className="font-medium tabular-nums">{formatVariation(s.yearlyPct)}</dd>
            </div>
          </dl>
          {s.frequency === "daily" && s.refValue != null && (
            <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">Valor de hoy: {LEVEL.format(s.refValue)}</p>
          )}
        </>
      )}
      <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        <span className="truncate">{freshnessText(s)}</span>
      </p>
    </Card>
  );
}
