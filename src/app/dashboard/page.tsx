import Link from "next/link";
import {
  Wrench, Sparkles, TrendingUp, PieChart,
  LogIn, LogOut, ArrowRight, Bell, AlertTriangle, Wallet, ArrowUpFromLine, UserPlus,
} from "lucide-react";
import { getDashboardKPIs } from "@/lib/actions/kpis";
import { getMonthlyResults, type MonthlyResults } from "@/lib/actions/results";
import { getCurrentOrg } from "@/lib/actions/org";
import { listAccounts } from "@/lib/actions/cash";
import { listUnitsForBookingForm } from "@/lib/actions/units";
import { can } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuickExpenseDialog } from "@/components/cash/quick-expense-dialog";
import RevenueChart from "@/components/dashboard/revenue-chart-lazy";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";
import { UNIT_STATUS_META } from "@/lib/constants";
import { MONTHS } from "@/lib/settlements/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { todayYmdInTz, DEFAULT_ORG_TIMEZONE } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { LiveRefresh } from "@/components/realtime/live-refresh";

export default async function DashboardHome() {
  // getCurrentOrg está cacheado por request (React.cache): pedirlo primero
  // no agrega round-trips y nos deja gatear el resultado del mes por rol
  // antes de dispararlo en paralelo con los KPIs.
  const { role, organization } = await getCurrentOrg();
  const canViewMoney = can(role, "payments", "view");
  const canViewBookings = can(role, "bookings", "view");
  // El flujo "completar datos" requiere editar reservas — sin esto la fila
  // sería un deep-link muerto para owner_view (que sólo tiene bookings.view).
  const canCompleteGuests = can(role, "bookings", "update");
  const canRegisterExpense = can(role, "cash", "create");
  // "Este mes" es el de la org, no el del proceso (Vercel corre en UTC).
  const todayStr = todayYmdInTz(organization.timezone || DEFAULT_ORG_TIMEZONE);
  const curYear = Number(todayStr.slice(0, 4));
  const curMonth = Number(todayStr.slice(5, 7));
  const [kpis, monthResults] = await Promise.all([
    getDashboardKPIs(),
    // Si el cálculo falla (p. ej. columnas nuevas aún no migradas) el inicio
    // no se cae: la card muestra un aviso y el resto sigue funcionando.
    canViewMoney
      ? getMonthlyResults(curYear, curMonth).catch((err: unknown): MonthlyResults | null => {
          console.error("[dashboard] getMonthlyResults falló", err);
          return null;
        })
      : Promise.resolve<MonthlyResults | null>(null),
  ]);
  const collectedEntries = Object.entries(kpis.finance.collected_30d_by_currency);
  const reservedEntries = Object.entries(kpis.finance.revenue_30d_by_currency);
  // "Por completar": huésped (requiere editar reservas) y precio (requiere ver plata).
  const missingGuest = canCompleteGuests ? kpis.bookings.pending_guest_data : 0;
  const missingPrice = canViewMoney ? kpis.bookings.pending_price : 0;
  const [expenseAccounts, expenseUnits] = canRegisterExpense
    ? await Promise.all([listAccounts(), listUnitsForBookingForm()])
    : [[], []];
  const expenseDefaultId =
    expenseAccounts.find((a) => a.is_expense_default)?.id ?? null;
  const statusHref = canViewBookings ? "/dashboard/unidades/kanban" : "/dashboard/unidades";
  // Layout: 3 cols si hay revenue, 2 cols si hay reservas pero no plata,
  // 1 col si el rol sólo ve Atención requerida (mantenimiento / limpieza).
  const gridCols = canViewMoney
    ? "grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4"
    : canViewBookings
      ? "grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4"
      : "grid grid-cols-1 gap-3 sm:gap-4";

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1600px] mx-auto">
      <LiveRefresh
        tables={["bookings", "units", "cleaning_tasks", "maintenance_tickets", "cash_movements"]}
        throttleMs={8_000}
      />
      {/* Hero */}
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <DashboardGreeting />
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {canRegisterExpense && (
            <QuickExpenseDialog accounts={expenseAccounts} defaultAccountId={expenseDefaultId} units={expenseUnits}>
              <Button variant="outline" className="gap-2 h-auto py-2.5 sm:py-3 border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/5">
                <span className="size-7 sm:size-8 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <ArrowUpFromLine size={16} />
                </span>
                <span className="text-left leading-tight">
                  <span className="block text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground font-normal">Gasto rápido</span>
                  <span className="block text-sm font-semibold">Registrar gasto</span>
                </span>
              </Button>
            </QuickExpenseDialog>
          )}
          <Card className="px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="size-9 sm:size-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">Ocupación 30d</div>
              <div className="text-xl sm:text-2xl font-bold tabular-nums">{kpis.occupancy_pct_30d.toFixed(1)}%</div>
            </div>
          </Card>
        </div>
      </div>

      {/* Status grid de units — 2 columnas en mobile, denso pero legible */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[
          { status: "disponible", count: kpis.totals.available_units },
          { status: "ocupado", count: kpis.totals.occupied_units },
          { status: "limpieza", count: kpis.totals.cleaning_units },
          { status: "mantenimiento", count: kpis.totals.maintenance_units },
        ].map(({ status, count }) => {
          const meta = UNIT_STATUS_META[status as keyof typeof UNIT_STATUS_META];
          return (
            <Link key={status} href={statusHref}>
              <Card className="p-3 sm:p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group h-full">
                <div className="flex items-center gap-2">
                  <span className="status-dot" style={{ backgroundColor: meta.color }} />
                  <span className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground truncate">{meta.label}</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold mt-1.5 sm:mt-2 tabular-nums" style={{ color: meta.color }}>
                  {count}
                </div>
                <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 sm:mt-1">
                  de {kpis.totals.units} {kpis.totals.units === 1 ? "unidad" : "unidades"}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className={gridCols}>
        {/* Cobrado — solo visible para roles con acceso a plata. El número
            grande sale de Caja (plata real); "Reservado" es lo contratado en
            las reservas, que en las de Booking/Airbnb entra en 0 hasta que
            alguien carga el importe. */}
        {canViewMoney && (
          <Card className="lg:col-span-2 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3 sm:mb-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                  Cobrado · 30 días
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Lo que entró en Caja por reservas y cobros extra
                </p>
                <div className="flex gap-4 sm:gap-6 mt-2 flex-wrap items-end">
                  {collectedEntries.map(([cur, val]) => (
                    <div key={cur}>
                      <div className="text-[10px] text-muted-foreground">{cur}</div>
                      <div className="text-xl sm:text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatMoney(val, cur)}
                      </div>
                    </div>
                  ))}
                  {collectedEntries.length === 0 && (
                    <span className="text-sm text-muted-foreground">Sin cobros registrados aún</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-end gap-1.5">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: "oklch(0.45 0.10 195)" }}
                    aria-hidden
                  />
                  Reservado
                </div>
                {reservedEntries.map(([cur, val]) => (
                  <div key={cur} className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatMoney(val, cur)}
                  </div>
                ))}
                {reservedEntries.length === 0 && (
                  <div className="text-sm text-muted-foreground">—</div>
                )}
                <div className="text-[10px] text-muted-foreground mt-0.5">check-out en ±30 días</div>
              </div>
            </div>
            <RevenueChart data={kpis.daily_revenue_30d} />
          </Card>
        )}

        {/* Atención requerida */}
        <Card className="p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Atención requerida</h2>
          <div className="space-y-2">
            {kpis.service.urgent_tickets > 0 && (
              <Link href="/dashboard/mantenimiento" className="flex items-center justify-between p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/40 transition-colors">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400" />
                  <span className="text-sm font-medium">Tickets urgentes</span>
                </div>
                <Badge className="bg-rose-500 text-white">{kpis.service.urgent_tickets}</Badge>
              </Link>
            )}
            {(missingGuest > 0 || missingPrice > 0) && (
              <Link href="/dashboard/unidades/kanban?completar=1" className="block p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserPlus size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-sm font-medium">Reservas por completar</span>
                  </div>
                  <ArrowRight size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 pl-6 tabular-nums">
                  {[
                    missingGuest > 0 ? `${missingGuest} sin huésped` : null,
                    missingPrice > 0 ? `${missingPrice} sin precio` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {missingPrice > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 pl-6 leading-snug">
                    Las reservas de Booking/Airbnb entran sin importe: cargalo para que el
                    resultado del mes sea real.
                  </p>
                )}
              </Link>
            )}
            <Link href="/dashboard/mantenimiento" className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-2">
                <Wrench size={16} className="text-orange-500" />
                <span className="text-sm">Mantenimiento abierto</span>
              </div>
              <Badge variant="secondary">{kpis.service.open_tickets}</Badge>
            </Link>
            <Link href="/dashboard/limpieza" className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-cyan-500" />
                <span className="text-sm">Limpieza pendiente</span>
              </div>
              <Badge variant="secondary">{kpis.service.cleaning_pending}</Badge>
            </Link>
            <Link href="/dashboard/tareas" className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-purple-500" />
                <span className="text-sm">Tareas pendientes</span>
              </div>
              <Badge variant="secondary">{kpis.service.concierge_pending}</Badge>
            </Link>
            {canViewMoney && Object.entries(kpis.finance.pending_payment_by_currency).map(([cur, amt]) => (
              <div key={cur} className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-amber-600 dark:text-amber-400" />
                  <span className="text-sm">Por cobrar ({cur})</span>
                </div>
                <span className="font-semibold text-sm">{formatMoney(amt, cur)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Resultado del mes — mismas reglas que la liquidación (ver
            src/lib/actions/results.ts): temporario cuenta en el mes del
            check-out, mensual se prorratea. */}
        {canViewMoney && (
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 min-w-0">
                <PieChart size={14} className="text-violet-500 shrink-0" />
                <span className="truncate">Resultado · {MONTHS[curMonth - 1]}</span>
              </h2>
              <Link href={`/dashboard/resultados?year=${curYear}&month=${curMonth}`} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                Ver detalle <ArrowRight className="inline" size={11} />
              </Link>
            </div>
            {monthResults === null ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No se pudo calcular el resultado del mes
              </p>
            ) : monthResults.totals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin reservas con check-out este mes
              </p>
            ) : (
              <div className="space-y-3">
                {monthResults.totals.map((t) => (
                  <div key={t.currency}>
                    {monthResults.totals.length > 1 && (
                      <div className="text-[10px] text-muted-foreground mb-1">{t.currency}</div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <MonthStat label="Ventas" value={formatMoney(t.total, t.currency)} />
                      <MonthStat label="Plataformas" value={formatMoney(t.channel_commission, t.currency)} tone="rose" />
                      <MonthStat label="Tu comisión" value={formatMoney(t.commission, t.currency)} tone="violet" />
                      <MonthStat label="A propietarios" value={formatMoney(t.owner_net, t.currency)} tone="emerald" />
                    </div>
                  </div>
                ))}
                {monthResults.missing_price_count > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                    {monthResults.missing_price_count === 1
                      ? "1 reserva sin importe cargado: el resultado está incompleto."
                      : `${monthResults.missing_price_count} reservas sin importe cargado: el resultado está incompleto.`}
                  </p>
                )}
              </div>
            )}
          </Card>
        )}

        {canViewBookings && (
          <>
            {/* Next check-ins */}
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <LogIn size={14} className="text-emerald-500" />
                  Próximos check-in
                </h2>
                <Link href="/dashboard/reservas" className="text-xs text-muted-foreground hover:text-foreground">
                  Ver todos <ArrowRight className="inline" size={11} />
                </Link>
              </div>
              {kpis.next_check_ins.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin reservas próximas</p>
              ) : (
                <div className="space-y-2">
                  {kpis.next_check_ins.map((b) => (
                    <Link key={b.id} href={`/dashboard/reservas/${b.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors">
                      <DateTile date={b.check_in_date} variant="emerald" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{b.guest_name ?? "Sin huésped"}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{b.unit_code}</span> · {b.guests_count}p
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Next check-outs */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <LogOut size={14} className="text-cyan-500" />
                  Próximos check-out
                </h2>
              </div>
              {kpis.next_check_outs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin check-outs próximos</p>
              ) : (
                <div className="space-y-2">
                  {kpis.next_check_outs.map((b) => (
                    <Link key={b.id} href={`/dashboard/reservas/${b.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors">
                      <DateTile date={b.check_out_date} variant="cyan" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{b.guest_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{b.unit_code}</span> · {b.check_out_time}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function MonthStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "rose" | "violet" | "emerald";
}) {
  const tones = {
    default: "text-foreground",
    rose: "text-rose-600 dark:text-rose-400",
    violet: "text-violet-700 dark:text-violet-300",
    emerald: "text-emerald-700 dark:text-emerald-400",
  } as const;
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={cn("text-sm sm:text-base font-semibold tabular-nums truncate", tones[tone])}>{value}</div>
    </div>
  );
}

function DateTile({
  date,
  variant,
}: {
  date: string;
  variant: "emerald" | "cyan";
}) {
  const styles = {
    emerald:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    cyan: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  } as const;
  return (
    <div
      className={cn(
        "shrink-0 w-12 h-12 rounded-lg border flex flex-col items-center justify-center leading-none",
        styles[variant]
      )}
    >
      <span className="text-base font-bold tabular-nums">
        {formatDate(date, "d")}
      </span>
      <span className="text-[9px] uppercase tracking-wider mt-0.5 opacity-80">
        {formatDate(date, "MMM")}
      </span>
    </div>
  );
}
