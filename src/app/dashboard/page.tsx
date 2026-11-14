import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpFromLine, Bell, CalendarPlus, Inbox, Sparkles, UserPlus, Wrench } from "lucide-react";
import { getDashboardKPIs } from "@/lib/actions/kpis";
import { getCurrentOrg } from "@/lib/actions/org";
import { getSession } from "@/lib/actions/auth";
import { listAccounts } from "@/lib/actions/cash";
import { listUnitsForBookingForm } from "@/lib/actions/units";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { QuickExpenseDialog } from "@/components/cash/quick-expense-dialog";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { TodayBrief, TodayBriefSkeleton } from "@/components/mobile/today-brief";
import { QuickActions } from "@/components/mobile/quick-actions";
import { DayBoard, DayBoardSkeleton } from "@/components/dashboard/home/day-board";
import { AttentionCard, type AttentionItem } from "@/components/dashboard/home/attention";
import { UnitsNowCard } from "@/components/dashboard/home/units-now";
import { MoneyCard } from "@/components/dashboard/home/money";
import { MonthResultCard, MonthResultSkeleton } from "@/components/dashboard/home/month-result";
import { UpcomingCard } from "@/components/dashboard/home/upcoming";
import { loadToday } from "@/lib/dashboard/today-data";
import { getDaypart, getFirstName } from "@/lib/contextual-messages";
import { formatDate } from "@/lib/format";
import { todayYmdInTz, DEFAULT_ORG_TIMEZONE } from "@/lib/dates";

/*
 * El Resumen (Hoy). En orden de lo que se mira a la mañana:
 *   1. El día: quién entra, quién sale, qué hay que limpiar (DayBoard).
 *   2. Lo que espera a alguien, y las unidades en una barra.
 *   3. La plata: lo cobrado en 30 días y el resultado del mes.
 *   4. Lo que viene después de hoy.
 * En el celular el día lo cuenta "Tex te cuenta" con los accesos rápidos; el
 * tablero de tres columnas es de la compu. Los dos leen el día una sola vez
 * (`loadToday`, por request).
 */
export default async function DashboardHome() {
  // getCurrentOrg y getSession están cacheados por request (React.cache).
  const [{ role, organization }, session] = await Promise.all([getCurrentOrg(), getSession()]);
  const canViewMoney = can(role, "payments", "view");
  const canViewBookings = can(role, "bookings", "view");
  // "Completar datos" requiere editar reservas: sin esto sería un link muerto
  // para owner_view (que sólo tiene bookings.view).
  const canCompleteGuests = can(role, "bookings", "update");
  const canRegisterExpense = can(role, "cash", "create");
  const canCreateBooking = canViewBookings && can(role, "bookings", "create");
  // Propietario: el inicio ya viene acotado a sus unidades (getDashboardKPIs) y
  // no ve "Para atender" ni el día, que son operación de la administración.
  const isOwner = role === "owner_view";
  const showDay = !isOwner && canViewBookings && can(role, "parte_diario", "view");
  const texOn = organization.tex_enabled && !isOwner;

  // "Hoy" es el de la org, no el del proceso (Vercel corre en UTC).
  const today = todayYmdInTz(organization.timezone || DEFAULT_ORG_TIMEZONE);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  const [kpis, day, expense] = await Promise.all([
    getDashboardKPIs(),
    // Las solicitudes salen de la misma lectura del día que usa el tablero.
    showDay ? loadToday(today) : Promise.resolve(null),
    canRegisterExpense ? Promise.all([listAccounts(), listUnitsForBookingForm()]) : Promise.resolve(null),
  ]);
  const [expenseAccounts, expenseUnits] = expense ?? [[], []];
  const expenseDefaultId = expenseAccounts.find((a) => a.is_expense_default)?.id ?? null;

  const firstName = getFirstName(session?.profile.full_name, organization.name);
  const { greeting } = getDaypart();
  const dateLabel = capitalize(formatDate(today, "EEEE d 'de' MMMM"));

  const attention = isOwner
    ? []
    : attentionItems({
        requests: day?.requests ?? 0,
        urgentTickets: kpis.service.urgent_tickets,
        openTickets: kpis.service.open_tickets,
        cleaningPending: kpis.service.cleaning_pending,
        tasksPending: kpis.service.concierge_pending,
        missingGuest: canCompleteGuests ? kpis.bookings.pending_guest_data : 0,
        missingPrice: canViewMoney && canCompleteGuests ? kpis.bookings.pending_price : 0,
      });
  const unitsHref = canViewBookings ? "/dashboard/unidades/kanban" : "/dashboard/unidades";

  const expenseButton = (className: string, label: string) =>
    canRegisterExpense ? (
      <QuickExpenseDialog accounts={expenseAccounts} defaultAccountId={expenseDefaultId} units={expenseUnits}>
        <button type="button" className={className}>
          <ArrowUpFromLine className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
          {label}
        </button>
      </QuickExpenseDialog>
    ) : null;

  return (
    <div className="page-x page-y mx-auto max-w-[1600px] space-y-5 md:space-y-6 @container">
      <LiveRefresh
        tables={["bookings", "units", "cleaning_tasks", "maintenance_tickets", "cash_movements"]}
        throttleMs={8_000}
      />

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{dateLabel}</p>
          <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">
            {greeting}, <span className="brand-text-gradient">{firstName}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-md:hidden">
          {expenseButton(
            "inline-flex h-10 items-center gap-2 rounded-full border border-border/80 bg-card px-4 text-[13px] font-semibold transition-colors hover:bg-muted/60",
            "Registrar gasto",
          )}
          {canCreateBooking ? (
            <Button asChild className="h-10 gap-2 rounded-full px-4 text-[13px] font-semibold">
              <Link href="/dashboard/unidades/kanban">
                <CalendarPlus className="size-4" aria-hidden />
                Nueva reserva
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {/* Celular: el día lo cuenta Tex, con los accesos rápidos. */}
      {!isOwner ? (
        <div className="space-y-3 md:hidden">
          <Suspense fallback={<TodayBriefSkeleton />}>
            <TodayBrief texEnabled={organization.tex_enabled} />
          </Suspense>
          <QuickActions
            texEnabled={organization.tex_enabled}
            canBookings={canCreateBooking}
            canPayments={can(role, "payments", "create")}
            canTickets={can(role, "tickets", "create")}
            expenseSlot={expenseButton(
              "lg-tile flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2.5 text-[14px] font-semibold whitespace-nowrap active:scale-[0.97]",
              "Gasto",
            )}
          />
        </div>
      ) : null}

      {/* Compu: el día en tres columnas. */}
      {showDay ? (
        <div className="max-md:hidden">
          <Suspense fallback={<DayBoardSkeleton />}>
            <DayBoard texEnabled={texOn} />
          </Suspense>
        </div>
      ) : null}

      <div className="grid gap-5 @4xl:grid-cols-3">
        {!isOwner ? <AttentionCard items={attention} className="@4xl:col-span-2" /> : null}
        <UnitsNowCard
          totals={kpis.totals}
          occupancy30d={kpis.occupancy_pct_30d}
          href={unitsHref}
          className={isOwner ? "@4xl:col-span-1" : undefined}
        />
        {isOwner && canViewBookings ? (
          <UpcomingCard
            arrivals={kpis.next_check_ins}
            departures={kpis.next_check_outs}
            today={today}
            className="@4xl:col-span-2"
          />
        ) : null}
      </div>

      {canViewMoney ? (
        <div className="grid gap-5 @4xl:grid-cols-3">
          <MoneyCard
            className="@4xl:col-span-2"
            collected={kpis.finance.collected_30d_by_currency}
            reserved={kpis.finance.revenue_30d_by_currency}
            pending={kpis.finance.pending_payment_by_currency}
            daily={kpis.daily_revenue_30d}
          />
          <Suspense fallback={<MonthResultSkeleton year={year} month={month} />}>
            <MonthResultCard year={year} month={month} />
          </Suspense>
        </div>
      ) : null}

      {!isOwner && canViewBookings ? (
        <UpcomingCard arrivals={kpis.next_check_ins} departures={kpis.next_check_outs} today={today} />
      ) : null}
    </div>
  );
}

function attentionItems(c: {
  requests: number;
  urgentTickets: number;
  openTickets: number;
  cleaningPending: number;
  tasksPending: number;
  missingGuest: number;
  missingPrice: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (c.requests > 0) {
    items.push({
      key: "requests",
      href: "/dashboard/reservas-pendientes",
      icon: Inbox,
      label: c.requests === 1 ? "Solicitud sin responder" : "Solicitudes sin responder",
      value: String(c.requests),
      detail: "Pedidos de la web que esperan tu respuesta",
      tone: "amber",
    });
  }
  if (c.urgentTickets > 0) {
    items.push({
      key: "urgent",
      href: "/dashboard/mantenimiento",
      icon: AlertTriangle,
      label: c.urgentTickets === 1 ? "Arreglo urgente" : "Arreglos urgentes",
      value: String(c.urgentTickets),
      tone: "rose",
    });
  }
  if (c.missingPrice > 0 || c.missingGuest > 0) {
    const byPrice = c.missingPrice > 0;
    items.push({
      key: "complete",
      href: "/dashboard/unidades/kanban?completar=1",
      icon: UserPlus,
      label: byPrice ? "Reservas sin precio" : "Reservas sin huésped",
      value: String(byPrice ? c.missingPrice : c.missingGuest),
      detail: byPrice
        ? `Las de Booking y Airbnb entran sin importe: cargalo para que el mes cierre bien.${
            c.missingGuest > 0 ? ` Y ${c.missingGuest} sin huésped.` : ""
          }`
        : "Les falta el nombre de quien viene",
      tone: "amber",
    });
  }
  if (c.openTickets > 0) {
    items.push({
      key: "tickets",
      href: "/dashboard/mantenimiento",
      icon: Wrench,
      label: "Mantenimiento abierto",
      value: String(c.openTickets),
      tone: "neutral",
    });
  }
  if (c.cleaningPending > 0) {
    items.push({
      key: "cleaning",
      href: "/dashboard/limpieza",
      icon: Sparkles,
      label: "Limpiezas pendientes",
      value: String(c.cleaningPending),
      tone: "neutral",
    });
  }
  if (c.tasksPending > 0) {
    items.push({
      key: "tasks",
      href: "/dashboard/tareas",
      icon: Bell,
      label: "Tareas pendientes",
      value: String(c.tasksPending),
      tone: "neutral",
    });
  }
  return items;
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase("es-AR") + s.slice(1);
}
