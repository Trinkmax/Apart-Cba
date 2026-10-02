import Link from "next/link";
import { AlertTriangle, Archive, Building, KeyRound, ShieldCheck, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { EmptyState, KpiCard, PageHeader } from "@/components/rentals/ui";
import { NewPersonButton } from "@/components/rentals/people/new-person-button";
import { PeopleListClient } from "@/components/rentals/people/people-list-client";
import { listPeople } from "@/lib/actions/rentals-people";
import { formatMoney } from "@/lib/format";
import { requireRentalsPage } from "@/lib/rentals/server/access";

export const metadata = { title: "Inquilinos y garantes · rentOS" };

export default async function PersonasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRentalsPage();
  const sp = await searchParams;
  const showArchived = (Array.isArray(sp.archivadas) ? sp.archivadas[0] : sp.archivadas) === "1";
  const res = await listPeople({ includeArchived: true });

  if (!res.ok) {
    return (
      <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
        <PageHeader icon={Users} title="Inquilinos y garantes" />
        <Card className="p-5 flex-row items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="size-5 shrink-0 text-amber-500" />
          <p className="text-sm">{res.error}</p>
        </Card>
      </div>
    );
  }

  const active = res.items.filter((i) => i.person.active);
  const archived = res.items.filter((i) => !i.person.active);
  const live = (role: "inquilino" | "garante") => active.filter((i) => i.links.some((l) => l.role === role && l.status === "vigente")).length;
  const tenants = live("inquilino");
  const guarantors = live("garante");
  const debt = new Map<string, number>();
  let debtors = 0;
  for (const it of active) {
    let owes = false;
    for (const l of it.links) {
      if (l.role !== "inquilino" || l.status !== "vigente" || l.overdue <= 0.004) continue;
      debt.set(l.currency, (debt.get(l.currency) ?? 0) + l.overdue);
      owes = true;
    }
    if (owes) debtors++;
  }
  const debtText = [...debt.entries()].map(([c, v]) => formatMoney(v, c)).join(" · ");
  const list = showArchived ? archived : active;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <LiveRefresh tables={["rental_contracts", "rental_charges", "rental_payments"]} label="cambio" labelPlural="cambios" throttleMs={5_000} />
      <PageHeader
        icon={Users}
        title="Inquilinos y garantes"
        subtitle={active.length ? `${active.length} ${active.length === 1 ? "persona" : "personas"} · ${tenants} con contrato vigente` : "Las personas de tus contratos: quién alquila y quién garantiza"}
        actions={
          <>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/dashboard/alquileres/propiedades">
                <Building size={14} /> <span className="hidden sm:inline">Propiedades</span>
              </Link>
            </Button>
            <NewPersonButton />
          </>
        }
      />

      {active.length === 0 && !showArchived ? (
        <EmptyState
          icon={Users}
          title="Todavía no hay inquilinos ni garantes"
          description="Se cargan solos al hacer un contrato (podés crearlos en el mismo paso), o desde acá con “Nueva persona”. Una misma persona puede ser inquilina en un contrato y garante en otro."
          action={<NewPersonButton label="Cargar la primera persona" />}
        />
      ) : (
        <>
          {!showArchived && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <KpiCard label="Personas" icon={Users} value={active.length} />
              <KpiCard label="Inquilinos" icon={KeyRound} value={tenants} hint="Con contrato vigente" />
              <KpiCard label="Garantes" icon={ShieldCheck} value={guarantors} hint="De contratos vigentes" />
              <KpiCard
                label="Con deuda vencida"
                icon={Wallet}
                tone={debtors ? "out" : "in"}
                value={debtors}
                hint={debtors ? debtText : "Nadie debe cuotas vencidas"}
                href={debtors ? "/dashboard/alquileres/cobranzas" : undefined}
              />
            </div>
          )}
          {showArchived && (
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Archivadas ({archived.length})</h2>
              <Link href="/dashboard/alquileres/personas" className="text-xs text-muted-foreground hover:text-foreground">
                Volver a las activas
              </Link>
            </div>
          )}
          {list.length ? (
            <PeopleListClient items={list} />
          ) : (
            <Card className="p-8 text-center border-dashed text-sm text-muted-foreground">No hay personas archivadas.</Card>
          )}
          {!showArchived && archived.length > 0 && (
            <Link href="/dashboard/alquileres/personas?archivadas=1" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Archive size={13} /> Ver archivadas ({archived.length})
            </Link>
          )}
        </>
      )}
    </div>
  );
}
