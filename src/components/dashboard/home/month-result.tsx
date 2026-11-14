import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getMonthlyResults, type MonthlyResults } from "@/lib/actions/results";
import { MONTHS } from "@/lib/settlements/labels";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * Resultado del mes (ver src/lib/actions/results.ts): "Ventas" sale del
 * calendario (lo que pagó el huésped); comisión, diferencia de tarifa y neto
 * salen de las reservas ya liquidadas y conciliadas. Lo sin liquidar se muestra
 * aparte, estimado (≈). Temporario cuenta en el mes del check-out; mensual, por
 * noches del mes.
 */

const CARD =
  "@container rounded-[22px] border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6";

export async function MonthResultCard({ year, month, className }: { year: number; month: number; className?: string }) {
  // Si el cálculo falla (p. ej. columnas nuevas aún no migradas) el inicio no
  // se cae: la tarjeta muestra un aviso y el resto sigue funcionando.
  const results = await getMonthlyResults(year, month).catch((err: unknown): MonthlyResults | null => {
    console.error("[dashboard] getMonthlyResults falló", err);
    return null;
  });
  return <MonthResultView year={year} month={month} results={results} className={className} />;
}

export function MonthResultView({
  year,
  month,
  results,
  className,
}: {
  year: number;
  month: number;
  results: MonthlyResults | null;
  className?: string;
}) {
  // La moneda base de la org; si no tiene reservas contables, la primera que sí.
  const totals = results?.totals ?? [];
  const home =
    totals.find((t) => t.currency === results?.base_currency && t.bookings > 0) ??
    totals.find((t) => t.bookings > 0) ??
    totals.find((t) => t.currency === results?.base_currency) ??
    totals[0] ??
    null;
  const others = totals.filter((t) => t.bookings > 0 && t.currency !== home?.currency);

  return (
    <section className={cn(CARD, className)}>
      <Header
        year={year}
        month={month}
        subtitle={home && home.bookings > 0 ? `Liquidadas ${home.settled.bookings} de ${home.bookings}` : null}
      />
      {results === null ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">No se pudo calcular el resultado del mes.</p>
      ) : totals.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">Sin reservas con salida este mes.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {home ? (
            <>
              <div>
                <div className="text-[12px] text-muted-foreground">Ventas</div>
                <div className="mt-0.5 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
                  {formatMoney(home.guest_total, home.currency)}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                <Stat label="Plataformas" value={formatMoney(home.settled.channel + home.estimated.channel, home.currency)} tone="rose" />
                <Stat label="Dif. de tarifa" value={formatMoney(home.settled.rate_diff, home.currency)} tone="violetLight" />
                <Stat
                  label="Tu comisión"
                  value={formatMoney(home.settled.commission, home.currency)}
                  tone="violet"
                  hint={home.estimated.commission > 0 ? `≈ +${formatMoney(home.estimated.commission, home.currency)} sin liquidar` : null}
                />
                <Stat
                  label="A propietarios"
                  value={formatMoney(home.settled.owner_net, home.currency)}
                  tone="emerald"
                  hint={home.estimated.owner_net > 0 ? `≈ +${formatMoney(home.estimated.owner_net, home.currency)} sin liquidar` : null}
                />
              </dl>
            </>
          ) : null}
          {others.length > 0 ? (
            <p className="text-[12px] leading-snug text-muted-foreground tabular-nums">
              {others
                .map((t) => `${t.currency} · ${t.bookings} ${t.bookings === 1 ? "reserva" : "reservas"} · Ventas ${formatMoney(t.guest_total, t.currency)}`)
                .join(" · ")}
            </p>
          ) : null}
          {results.missing_price_count > 0 ? (
            <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-300">
              {results.missing_price_count === 1
                ? "1 reserva sin importe cargado: el resultado está incompleto."
                : `${results.missing_price_count} reservas sin importe cargado: el resultado está incompleto.`}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function MonthResultSkeleton({ year, month, className }: { year: number; month: number; className?: string }) {
  return (
    <section className={cn(CARD, className)}>
      <Header year={year} month={month} />
      <div className="mt-4 space-y-2" aria-hidden>
        <div className="h-9 w-48 animate-pulse rounded-lg bg-muted/60" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    </section>
  );
}

function Header({ year, month, subtitle }: { year: number; month: number; subtitle?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold">Resultado de {MONTHS[month - 1]?.toLowerCase()}</h2>
        {subtitle ? <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">{subtitle}</p> : null}
      </div>
      <Link
        href={`/dashboard/resultados?year=${year}&month=${month}`}
        className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        Detalle <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint = null,
}: {
  label: string;
  value: string;
  tone: "rose" | "violet" | "violetLight" | "emerald";
  /** Segunda línea gris (p. ej. "≈ +$ 120.000 sin liquidar"). */
  hint?: string | null;
}) {
  const tones = {
    rose: "text-rose-600 dark:text-rose-400",
    violet: "text-violet-700 dark:text-violet-300",
    violetLight: "text-violet-500 dark:text-violet-400",
    emerald: "text-emerald-700 dark:text-emerald-400",
  } as const;
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2.5">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      {/* Sin truncate: con el sidebar abierto el monto se cortaba. Se envuelve. */}
      <dd className={cn("text-[14px] font-semibold break-words tabular-nums", tones[tone])}>{value}</dd>
      {hint ? <dd className="text-[11px] leading-snug break-words text-muted-foreground tabular-nums">{hint}</dd> : null}
    </div>
  );
}
