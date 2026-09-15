import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarX2, ChevronDown, PieChart, Settings2 } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { getMonthlyResults } from "@/lib/actions/results";
import { can } from "@/lib/permissions";
import { formatPeriod } from "@/lib/settlements/labels";
import { todayYmdInTz, DEFAULT_ORG_TIMEZONE } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { MonthNav } from "@/components/results/month-nav";
import { ResultsModeNav } from "@/components/results/results-mode-nav";
import { ResultsKpis } from "@/components/results/results-kpis";
import { ResultsReviewPanel } from "@/components/results/results-review-panel";
import { ResultsAggregateTable } from "@/components/results/results-aggregate-table";
import { ResultsBookingsTable } from "@/components/results/results-bookings-table";
import {
  parseAggregateView,
  parseResultsMode,
  resultsHref,
  toResultsRowView,
} from "@/components/results/results-meta";

/**
 * Resultados del mes: cuánto pagaron los huéspedes, cuánto se le rindió a cada
 * propietario y cuánto quedó en la administración.
 *
 * Lo que pagó el huésped sale SIEMPRE del calendario (bookings); lo que se le
 * liquida al propietario sale de su liquidación. La liquidación la editan los
 * operadores (el huésped paga 80.000 y al propietario se le rinde sobre
 * 70.000), así que no puede ser la fuente del ingreso: la diferencia se
 * muestra reserva por reserva, sin mezclarla con errores de carga.
 *
 * Todo server-rendered; mes, modo y vista viajan por la URL. El detalle de
 * reservas es cliente (lee filtro/moneda/pestaña de la URL).
 */

const HOW_IT_WORKS = [
  "Paga el huésped sale del calendario: el total de cada reserva. En mensuales, la renta del mes prorrateada por noches.",
  "Tarifa del propietario es el ingreso de esa reserva en su liquidación, sumando co-propietarios y todos los meses en que se liquidó.",
  "Diferencia de tarifa = lo que pagó el huésped, sin plataformas, menos la tarifa del propietario. Solo cuenta reservas liquidadas sin errores. Lo que se liquidó de más va aparte.",
  "Una reserva temporaria cuenta en el mes de su check-out, aunque se haya liquidado en varios meses.",
  "Otros cargos y la columna Liquidación salen de las liquidaciones de este mes. Las reservas sin liquidar se estiman (≈) sin diferencia de tarifa.",
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, organization } = await getCurrentOrg();
  // Misma puerta que el sidebar y que getMonthlyResults: `settlements.view` no
  // alcanza (owner_view lo tiene para SUS liquidaciones y acá se ven todas).
  if (!can(role, "payments", "view")) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  // "Este mes" es el de la org, no el del proceso (Vercel corre en UTC).
  const todayStr = todayYmdInTz(organization.timezone || DEFAULT_ORG_TIMEZONE);
  const todayYear = Number(todayStr.slice(0, 4));
  const todayMonth = Number(todayStr.slice(5, 7));
  // La URL es editable: un año negativo o absurdo arma una fecha inválida en
  // la query y termina en el error boundary. Fuera de rango → mes actual.
  const yearParam = Number(first(sp.year));
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= todayYear + 5
      ? yearParam
      : todayYear;
  const monthParam = Math.trunc(Number(first(sp.month)));
  const month = monthParam >= 1 && monthParam <= 12 ? monthParam : todayMonth;
  const mode = parseResultsMode(sp.modo);
  const vista = parseAggregateView(sp.vista);

  const results = await getMonthlyResults(year, month, { mode });
  const periodLabel = formatPeriod(year, month);
  const baseCurrency = results.base_currency;
  // Un mes sin reservas puede igual tener liquidaciones (filas manuales, un
  // ticket): eso también es algo que mostrar. Pero puente y huérfanas no se
  // parten por modo, así que con Temporarios/Mensuales sin filas el mensaje
  // correcto es "sin reservas de ese tipo" (con el link a Todos).
  const isEmpty =
    results.rows.length === 0 &&
    (mode !== "todos" || (results.orphans.length === 0 && results.bridges.length === 0));

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh
        tables={["bookings", "cash_movements", "units"]}
        label="reserva"
        labelPlural="reservas"
        throttleMs={5_000}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PieChart className="size-5 text-violet-500" /> Resultados
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            Cuánto pagaron los huéspedes, cuánto se le rinde a cada propietario y cuánto queda en la administración
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ResultsModeNav year={year} month={month} mode={mode} vista={vista} />
          <MonthNav
            year={year}
            month={month}
            todayYear={todayYear}
            todayMonth={todayMonth}
            mode={mode}
            vista={vista}
          />
        </div>
      </div>

      {isEmpty ? (
        <Card className="p-8 sm:p-12 items-center text-center gap-3">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <CalendarX2 size={22} />
          </div>
          <div>
            <p className="text-base font-semibold">
              {mode === "mensual"
                ? `Sin contratos mensuales en ${periodLabel}`
                : mode === "temporario"
                  ? `Sin reservas temporarias con check-out en ${periodLabel}`
                  : `Sin reservas con check-out en ${periodLabel}`}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Una reserva temporaria cuenta en el mes en que hace check-out, no en el que se cobra ni en el
              que llega. Las mensuales se prorratean por las noches del mes.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {mode !== "todos" && (
              <Link
                href={resultsHref(year, month, { vista })}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                Ver todas <ArrowRight size={12} />
              </Link>
            )}
            <Link
              href="/dashboard/reservas"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Ver reservas <ArrowRight size={12} />
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <ResultsKpis
            totals={results.totals}
            close={results.close}
            baseCurrency={baseCurrency}
            year={year}
            month={month}
            mode={mode}
            vista={vista}
          />

          <ResultsReviewPanel review={results.review} year={year} month={month} mode={mode} vista={vista} />

          <ResultsAggregateTable
            byUnit={results.by_unit}
            byOwner={results.by_owner}
            byChannel={results.by_channel}
            vista={vista}
            year={year}
            month={month}
            mode={mode}
            baseCurrency={baseCurrency}
          />

          {/* El ancla #detalle la pone la propia tabla (no repetirla acá). */}
          <Suspense fallback={<div className="h-[28rem] rounded-xl border bg-card animate-pulse" />}>
            <ResultsBookingsTable
              rows={results.rows.map(toResultsRowView)}
              orphans={results.orphans}
              year={year}
              month={month}
              mode={mode}
              vista={vista}
              baseCurrency={baseCurrency}
              firstSettlementPeriod={results.first_settlement_period}
            />
          </Suspense>
        </>
      )}

      {/* Cómo se calcula: cerrado por defecto, al pie. */}
      <details className="group rounded-xl border bg-muted/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Settings2 size={14} className="text-muted-foreground" aria-hidden /> Cómo se calcula
          </span>
          <ChevronDown
            size={16}
            className="text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 sm:px-5">
          <ul className="min-w-0 max-w-3xl list-disc space-y-1.5 pl-4 text-[12px] leading-snug text-muted-foreground">
            {HOW_IT_WORKS.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <Link
            href="/dashboard/configuracion/comisiones"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
          >
            Ajustar comisiones <ArrowRight size={12} />
          </Link>
        </div>
      </details>
    </div>
  );
}
