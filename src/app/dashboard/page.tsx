import Link from "next/link";
import {
  Building2, CalendarDays, Wrench, Sparkles, TrendingUp,
  LogIn, LogOut, ArrowRight, Bell, AlertTriangle, Wallet,
} from "lucide-react";
import { getDashboardKPIs } from "@/lib/actions/kpis";
import { getCurrentOrg } from "@/lib/actions/org";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { UNIT_STATUS_META } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function DashboardHome() {
  const [{ organization, role }, kpis] = await Promise.all([getCurrentOrg(), getDashboardKPIs()]);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Hero */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Hola, <span className="brand-text-gradient">{organization.name}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatDate(new Date(), "EEEE d 'de' MMMM, yyyy")} · Rol: {role}
          </p>
        </div>
        <Card className="px-5 py-3 flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
            <TrendingUp size={18} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ocupación 30d</div>
            <div className="text-2xl font-bold tabular-nums">{kpis.occupancy_pct_30d.toFixed(1)}%</div>
          </div>
        </Card>
      </div>

      {/* Status grid de units */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { status: "disponible", count: kpis.totals.available_units },
          { status: "reservado", count: 0 },
          { status: "ocupado", count: kpis.totals.occupied_units },
          { status: "limpieza", count: kpis.totals.cleaning_units },
          { status: "mantenimiento", count: kpis.totals.maintenance_units },
        ].map(({ status, count }) => {
          const meta = UNIT_STATUS_META[status as keyof typeof UNIT_STATUS_META];
          return (
            <Link key={status} href="/dashboard/unidades/kanban">
              <Card className="p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
                <div className="flex items-center gap-2">
                  <span className="status-dot" style={{ backgroundColor: meta.color }} />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                </div>
                <div className="text-3xl font-bold mt-2 tabular-nums" style={{ color: meta.color }}>
                  {count}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  de {kpis.totals.units} unidades
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue chart */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Revenue 30 días</h2>
              <div className="flex gap-4 mt-2">
                {Object.entries(kpis.finance.revenue_30d_by_currency).map(([cur, val]) => (
                  <div key={cur}>
                    <div className="text-[10px] text-muted-foreground">{cur}</div>
                    <div className="text-lg font-semibold tabular-nums">{formatMoney(val, cur)}</div>
                  </div>
                ))}
                {Object.keys(kpis.finance.revenue_30d_by_currency).length === 0 && (
                  <span className="text-sm text-muted-foreground">Sin movimiento aún</span>
                )}
              </div>
            </div>
          </div>
          <RevenueChart data={kpis.daily_revenue_30d} />
        </Card>

        {/* Atención requerida */}
        <Card className="p-5 space-y-3">
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
            <Link href="/dashboard/conserjeria" className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-purple-500" />
                <span className="text-sm">Conserjería pendiente</span>
              </div>
              <Badge variant="secondary">{kpis.service.concierge_pending}</Badge>
            </Link>
            {Object.entries(kpis.finance.pending_payment_by_currency).map(([cur, amt]) => (
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

        {/* Next check-ins */}
        <Card className="p-5">
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
      </div>
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
