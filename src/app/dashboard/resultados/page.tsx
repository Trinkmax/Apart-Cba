import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarX2, PieChart, Settings2 } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { getMonthlyResults } from "@/lib/actions/results";
import { can } from "@/lib/permissions";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import { COMMISSION_BASE_META } from "@/lib/finance/booking-economics";
import { formatPeriod } from "@/lib/settlements/labels";
import { todayYmdInTz, DEFAULT_ORG_TIMEZONE } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { MonthNav } from "@/components/results/month-nav";
import { ResultsAlerts } from "@/components/results/results-alerts";
import { ResultsSummary } from "@/components/results/results-summary";
import { ResultsByChannelTable } from "@/components/results/results-by-channel-table";
import { ResultsByOwnerTable } from "@/components/results/results-by-owner-table";
import { ResultsBookingsTable } from "@/components/results/results-bookings-table";
import type { BookingSource } from "@/lib/types/database";

/**
 * Resultados del mes — "¿dónde sale cuánto tengo que pagar a los propietarios,
 * cuánto cobro yo y cuánto se llevan las plataformas?". Sólo lectura: los
 * números salen de getMonthlyResults, que usa las mismas reglas que la
 * liquidación. Todo server-rendered; el mes viaja por ?year&month.
 */
export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
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
  const yearParam = Number(sp.year);
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= todayYear + 5
      ? yearParam
      : todayYear;
  const monthParam = Math.trunc(Number(sp.month));
  const month = monthParam >= 1 && monthParam <= 12 ? monthParam : todayMonth;

  const results = await getMonthlyResults(year, month);
  const multiCurrency = results.totals.length > 1;
  const periodLabel = formatPeriod(year, month);
  const configuredChannels = (Object.entries(results.channel_commissions) as Array<[BookingSource, number | undefined]>)
    .filter(([, pct]) => pct !== undefined && pct !== null && pct > 0)
    .map(([source, pct]) => `${BOOKING_SOURCE_META[source]?.label ?? source} ${pct}%`);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh tables={["bookings"]} label="reserva" labelPlural="reservas" throttleMs={5_000} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <PieChart className="size-5 text-violet-500" /> Resultados
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            Qué entra, qué se lleva cada uno y qué le queda a cada propietario
          </p>
        </div>
        <MonthNav year={year} month={month} todayYear={todayYear} todayMonth={todayMonth} />
      </div>

      <ResultsAlerts results={results} />

      {results.rows.length === 0 ? (
        <Card className="p-8 sm:p-12 items-center text-center gap-3">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <CalendarX2 size={22} />
          </div>
          <div>
            <p className="text-base font-semibold">Sin reservas con check-out en {periodLabel}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Una reserva temporaria cuenta en el mes en que hace check-out, no en el que
              se cobra ni en el que llega. Las mensuales se prorratean por los días del mes.
            </p>
          </div>
          <Link
            href="/dashboard/reservas"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Ver reservas <ArrowRight size={12} />
          </Link>
        </Card>
      ) : (
        <>
          <ResultsSummary totals={results.totals} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 md:gap-6">
            <ResultsByChannelTable rows={results.by_channel} multiCurrency={multiCurrency} />
            <ResultsByOwnerTable
              rows={results.by_owner}
              year={year}
              month={month}
              multiCurrency={multiCurrency}
            />
          </div>

          <ResultsBookingsTable rows={results.rows} />
        </>
      )}

      {/* Cómo se calcula */}
      <Card className="p-4 sm:p-5 gap-2 bg-muted/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Settings2 size={14} className="text-muted-foreground" /> Cómo se calcula
            </h2>
            <ul className="text-[12px] text-muted-foreground mt-1.5 space-y-1 leading-snug">
              <li>
                <span className="font-medium text-foreground">Plataformas:</span> total × % del canal
                {configuredChannels.length > 0 ? ` (${configuredChannels.join(" · ")})` : " (ningún canal configurado)"}.
              </li>
              <li>
                <span className="font-medium text-foreground">Tu comisión:</span>{" "}
                {COMMISSION_BASE_META[results.commission_base].label.toLowerCase()} — el % es el de cada
                unidad (o el del propietario, si tiene uno propio).
              </li>
              <li>
                <span className="font-medium text-foreground">Limpieza:</span> viene incluida en lo que paga el
                huésped y queda en la administración, por eso se descuenta al propietario.
              </li>
              <li>
                <span className="font-medium text-foreground">Cobrado:</span> lo registrado en la reserva. Lo que
                falta cobrar no cambia el reparto: se reparte el total.
              </li>
            </ul>
          </div>
          <Link
            href="/dashboard/configuracion/comisiones"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
          >
            Ajustar comisiones <ArrowRight size={12} />
          </Link>
        </div>
      </Card>
    </div>
  );
}
