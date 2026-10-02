import Link from "next/link";
import { ArrowRight, Building2, HandCoins, Percent, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/settlements/labels";
import { longDate } from "@/components/rentals/adjustments/adjustment-text";
import { Money, StackedBar } from "@/components/rentals/ui";
import { currenciesOf, type CurrencyAmounts, type RentalsDashboardData } from "./dashboard-types";

/**
 * Encabezado del resumen: saludo, el día y los 4 números que responden "¿cómo
 * vamos?": cobrado del mes contra lo esperado, deuda vencida, contratos y
 * ocupación, honorarios del mes.
 */

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function weekday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function Others({ map, main, className }: { map: CurrencyAmounts; main: string; className?: string }) {
  const rest = Object.entries(map).filter(([c, v]) => c !== main && Math.abs(v) > 0.005);
  if (!rest.length) return null;
  return (
    <p className={cn("text-[11px] text-muted-foreground", className)}>
      {rest.map(([c, v], i) => (
        <span key={c}>
          {i > 0 && " · "}+ <Money amount={v} currency={c} />
        </span>
      ))}
    </p>
  );
}

function Tile({
  href,
  label,
  icon: Icon,
  children,
  className,
}: {
  href: string;
  label: string;
  icon: typeof HandCoins;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("group block h-full", className)}>
      <Card className="h-full gap-0 p-4 sm:p-5 transition-all group-hover:shadow-md group-hover:border-primary/30">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Icon size={14} className="shrink-0" /> {label}
          </p>
          <ArrowRight size={13} className="text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
        </div>
        {children}
      </Card>
    </Link>
  );
}

export function DashboardHero({ data, canCreate }: { data: RentalsDashboardData; canCreate: boolean }) {
  const { kpis: k, mainCurrency: cur, today } = data;
  const month = MONTHS[Number(k.month.slice(5, 7)) - 1]?.toLowerCase() ?? "";
  const expected = k.expected[cur] ?? 0;
  const collected = k.collected[cur] ?? 0;
  const pending = k.pending[cur] ?? 0;
  const lateThisMonth = Math.max(0, expected - collected - pending);
  const pct = expected > 0 ? Math.round((collected / expected) * 100) : null;
  const overdue = k.overdue[cur] ?? 0;
  const occupancy = k.totalProperties > 0 ? Math.round((k.rentedProperties / k.totalProperties) * 100) : null;
  const urgent = data.agenda.counts.critical + data.agenda.counts.high;
  const extraCurrencies = currenciesOf(cur, k.overdue).length > 1;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 animate-fade-up">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            {data.greeting}
            {data.firstName ? `, ${data.firstName}` : ""}
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-muted-foreground first-letter:uppercase">
            {weekday(today)} {longDate(today).replace(/ de \d{4}$/, "")}
            {data.hasContracts && (
              <>
                {" · "}
                {k.activeContracts} {k.activeContracts === 1 ? "contrato vigente" : "contratos vigentes"}
                {urgent > 0 && (
                  <span className="text-rose-600 dark:text-rose-400">
                    {" · "}
                    {urgent} {urgent === 1 ? "cosa urgente" : "cosas urgentes"}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            {data.hasContracts && (
              <Button asChild variant="outline" className="gap-2">
                <Link href="/dashboard/alquileres/cobranzas">
                  <HandCoins size={15} /> Cobranzas
                </Link>
              </Button>
            )}
            <Button asChild className="gap-2">
              <Link href="/dashboard/alquileres/contratos/nuevo">
                <Plus size={15} /> <span className="hidden sm:inline">Nuevo contrato</span>
                <span className="sm:hidden">Nuevo</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {data.hasContracts && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Tile href="/dashboard/alquileres/cobranzas" label={`Cobrado de ${month}`} icon={HandCoins} className="col-span-2 lg:col-span-1">
            <Money amount={collected} currency={cur} tone="in" className="mt-2 block text-2xl sm:text-3xl font-bold tracking-tight" />
            <p className="mt-1 text-xs text-muted-foreground">
              {expected > 0 ? (
                <>
                  {pct}% de <Money amount={expected} currency={cur} />
                </>
              ) : (
                "Todavía no hay cargos este mes"
              )}
            </p>
            <StackedBar
              className="mt-3"
              segments={[
                { value: collected, color: "#10b981", label: "Cobrado" },
                { value: pending, color: "#94a3b8", label: "Por vencer" },
                { value: lateThisMonth, color: "#f43f5e", label: "Vencido" },
              ]}
            />
            <Others map={k.collected} main={cur} className="mt-1.5" />
          </Tile>
          <Tile href="/dashboard/alquileres/cobranzas" label="Deuda vencida" icon={TriangleAlert}>
            <Money amount={overdue} currency={cur} tone={overdue > 0 ? "out" : "muted"} className="mt-2 block text-xl sm:text-2xl font-semibold" />
            <p className="mt-1 text-xs text-muted-foreground">
              {k.overdueContracts === 0 ? "Nadie debe nada vencido" : `${k.overdueContracts} ${k.overdueContracts === 1 ? "inquilino debe" : "inquilinos deben"}`}
            </p>
            {extraCurrencies && <Others map={k.overdue} main={cur} className="mt-1" />}
          </Tile>
          <Tile href="/dashboard/alquileres/contratos" label="Contratos vigentes" icon={Building2}>
            <p className="mt-2 text-xl sm:text-2xl font-semibold tabular-nums">
              {k.activeContracts}
              {k.draftContracts > 0 && <span className="text-sm font-normal text-muted-foreground"> + {k.draftContracts} en borrador</span>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {k.vacantProperties > 0
                ? `${k.vacantProperties} ${k.vacantProperties === 1 ? "propiedad vacante" : "propiedades vacantes"}`
                : k.totalProperties > 0
                  ? "Ninguna propiedad vacante"
                  : "Sin propiedades cargadas"}
              {occupancy != null ? ` · ${occupancy}% ocupación` : ""}
            </p>
          </Tile>
          <Tile href="/dashboard/alquileres/rendiciones" label="Honorarios del mes" icon={Percent}>
            <Money amount={k.feesExpected[cur] ?? 0} currency={cur} className="mt-2 block text-xl sm:text-2xl font-semibold text-violet-700 dark:text-violet-300" />
            <p className="mt-1 text-xs text-muted-foreground">
              Ya cobrado <Money amount={k.feesCollected[cur] ?? 0} currency={cur} /> · estimado sin IVA
            </p>
          </Tile>
        </div>
      )}
    </div>
  );
}
