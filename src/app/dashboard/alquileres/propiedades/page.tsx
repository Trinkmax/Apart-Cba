import Link from "next/link";
import { AlertTriangle, Archive, Building, DoorOpen, KeyRound, Percent, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { KpiCard, PageHeader, StackedBar } from "@/components/rentals/ui";
import { NewPropertyButton } from "@/components/rentals/properties/new-property-button";
import { PropertiesListClient } from "@/components/rentals/properties/properties-list-client";
import { PropertiesOnboarding } from "@/components/rentals/properties/properties-onboarding";
import { PROPERTY_STATE_META } from "@/components/rentals/properties/property-helpers";
import type { PropertyListItem } from "@/components/rentals/properties/property-types";
import { listProperties } from "@/lib/actions/rentals-properties";
import { formatMoney } from "@/lib/format";
import { requireRentalsPage } from "@/lib/rentals/server/access";

export const metadata = { title: "Propiedades · rentOS" };

/** Suma por moneda ("$ 1.200.000 · US$ 800"), ARS primero. */
function sumByCurrency(rows: { amount: number; currency: string }[]): string | null {
  const m = new Map<string, number>();
  for (const r of rows) if (r.amount > 0) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount);
  if (!m.size) return null;
  return [...m.entries()]
    .sort((a, b) => (a[0] === "ARS" ? -1 : b[0] === "ARS" ? 1 : a[0].localeCompare(b[0])))
    .map(([c, v]) => formatMoney(v, c))
    .join(" · ");
}

export default async function PropiedadesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRentalsPage();
  const sp = await searchParams;
  const showArchived = (Array.isArray(sp.archivadas) ? sp.archivadas[0] : sp.archivadas) === "1";
  const res = await listProperties({ includeArchived: true });

  if (!res.ok) {
    return (
      <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
        <PageHeader icon={Building} title="Propiedades" />
        <Card className="p-5 flex-row items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="size-5 shrink-0 text-amber-500" />
          <p className="text-sm">{res.error}</p>
        </Card>
      </div>
    );
  }

  const active = res.items.filter((i) => i.property.active);
  const archived = res.items.filter((i) => !i.property.active);
  const count = (s: PropertyListItem["state"]) => active.filter((i) => i.state === s).length;
  const rented = count("alquilada");
  const vacant = count("vacante");
  const rentable = active.length - count("retirada");
  const occupancy = rentable ? Math.round((rented / rentable) * 100) : 0;
  const withDebt = active.filter((i) => (i.current?.overdue ?? 0) > 0.004).length;
  const vacantAsk = sumByCurrency(
    active.filter((i) => i.state === "vacante" && i.property.listing_rent).map((i) => ({ amount: Number(i.property.listing_rent), currency: i.property.listing_currency ?? "ARS" })),
  );
  const monthlyRent = sumByCurrency(active.filter((i) => i.current).map((i) => ({ amount: i.current!.current_rent, currency: i.current!.currency })));

  const subtitle = active.length
    ? `${active.length} ${active.length === 1 ? "propiedad" : "propiedades"} · ${rented} ${rented === 1 ? "alquilada" : "alquiladas"} · ${vacant} ${vacant === 1 ? "vacante" : "vacantes"}`
    : "Departamentos, casas y locales que administra la inmobiliaria";

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh tables={["rental_contracts", "rental_charges", "rental_payments"]} label="cambio" labelPlural="cambios" throttleMs={5_000} />
      <PageHeader
        icon={Building}
        title="Propiedades"
        subtitle={subtitle}
        actions={
          <>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/dashboard/alquileres/personas">
                <Users size={14} /> <span className="hidden sm:inline">Inquilinos y garantes</span>
                <span className="sm:hidden">Personas</span>
              </Link>
            </Button>
            <NewPropertyButton />
          </>
        }
      />

      {active.length === 0 && !showArchived ? (
        <>
          <PropertiesOnboarding />
          {archived.length > 0 && (
            <Link href="/dashboard/alquileres/propiedades?archivadas=1" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Archive size={13} /> Ver archivadas ({archived.length})
            </Link>
          )}
        </>
      ) : (
        <>
          {!showArchived && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard label="Propiedades" icon={Building} value={active.length} hint={monthlyRent ? `Alquileres vigentes: ${monthlyRent} por mes` : "Todavía sin contratos vigentes"} />
              <KpiCard
                label="Alquiladas"
                icon={KeyRound}
                tone="in"
                value={rented}
                hint={withDebt ? `${withDebt} con deuda vencida` : rented ? "Todas al día" : undefined}
              />
              <KpiCard
                label="Vacantes"
                icon={DoorOpen}
                tone={vacant ? "warn" : "neutral"}
                value={vacant}
                hint={vacantAsk ? `Piden ${vacantAsk} por mes` : vacant ? "Sin precio pretendido cargado" : "Ninguna sin inquilino"}
              />
              <KpiCard
                label="Ocupación"
                icon={Percent}
                value={`${occupancy} %`}
                hint={
                  <span className="block space-y-1.5">
                    <StackedBar
                      segments={[
                        { value: rented, color: PROPERTY_STATE_META.alquilada.color, label: "Alquiladas" },
                        { value: rentable - rented, color: PROPERTY_STATE_META.vacante.color, label: "Sin alquilar" },
                      ]}
                    />
                    <span className="block">
                      {rented} de {rentable} alquilables
                    </span>
                  </span>
                }
              />
            </div>
          )}

          {showArchived ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Archivadas ({archived.length})</h2>
                <Link href="/dashboard/alquileres/propiedades" className="text-xs text-muted-foreground hover:text-foreground">
                  Volver a las activas
                </Link>
              </div>
              {archived.length ? (
                <PropertiesListClient items={archived} today={ctx.today} />
              ) : (
                <Card className="p-8 text-center border-dashed text-sm text-muted-foreground">No hay propiedades archivadas.</Card>
              )}
            </div>
          ) : (
            <>
              <PropertiesListClient items={active} today={ctx.today} />
              {archived.length > 0 && (
                <Link href="/dashboard/alquileres/propiedades?archivadas=1" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Archive size={13} /> Ver archivadas ({archived.length})
                </Link>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
