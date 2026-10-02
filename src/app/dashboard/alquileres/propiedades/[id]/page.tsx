import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Building, NotebookPen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { PageHeader, StatusBadge } from "@/components/rentals/ui";
import { DocumentsSection, DocumentsSectionSkeleton } from "@/components/rentals/documents/documents-section";
import { ExpensesSection } from "@/components/rentals/expenses/expenses-section";
import { PropertyActions } from "@/components/rentals/properties/property-actions";
import { ContractsHistoryCard, CurrentContractCard } from "@/components/rentals/properties/property-contract-cards";
import { PROPERTY_STATE_META, propertyFeatures } from "@/components/rentals/properties/property-helpers";
import { ConsortiumCard, MandateCard, OwnersCard, PropertyEventsCard, ServicesCard } from "@/components/rentals/properties/property-side-cards";
import { getProperty } from "@/lib/actions/rentals-properties";
import { PROPERTY_TYPE_LABEL, propertyAddress } from "@/lib/rentals/labels";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { DetailError } from "@/components/rentals/properties/detail-error";

export const metadata = { title: "Propiedad · rentOS" };

function SectionSkeleton({ height = "h-40" }: { height?: string }) {
  return <div className={`${height} rounded-xl border bg-card animate-pulse`} />;
}

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRentalsPage();
  const { id } = await params;
  const res = await getProperty(id);
  if (!res.ok) {
    if (res.error.startsWith("No encontramos")) notFound();
    return <DetailError backHref="/dashboard/alquileres/propiedades" backLabel="Propiedades" message={res.error} />;
  }
  const { detail } = res;
  const p = detail.property;
  const features = propertyFeatures(p);
  const place = [p.neighborhood, p.city, p.province !== p.city ? p.province : null, p.postal_code ? `CP ${p.postal_code}` : null].filter(Boolean).join(", ");

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-5xl mx-auto">
      <LiveRefresh tables={["rental_contracts", "rental_charges", "rental_payments"]} label="cambio" labelPlural="cambios" throttleMs={5_000} />
      <PageHeader
        icon={Building}
        backHref="/dashboard/alquileres/propiedades"
        backLabel="Propiedades"
        title={propertyAddress(p)}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{p.code}</span>
            <StatusBadge meta={PROPERTY_STATE_META[detail.state]} compact />
            <span>{PROPERTY_TYPE_LABEL[p.property_type]}</span>
            {place && <span className="text-muted-foreground">· {place}</span>}
          </span>
        }
        actions={
          <PropertyActions
            property={p}
            owners={detail.owners.map((o) => ({ owner_id: o.owner_id, ownership_pct: o.ownership_pct, is_primary: o.is_primary }))}
            canNewContract={!detail.current && !detail.draft}
          />
        }
      />

      {features.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 -mt-1" aria-label="Características">
          {features.map((f) => (
            <li key={f} className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
              {f}
            </li>
          ))}
        </ul>
      )}

      {!p.active && (
        <Card className="p-4 border-slate-500/30 bg-slate-500/5 text-sm">
          Esta propiedad está archivada: no aparece en las listas ni en el alta de contratos. Podés volver a activarla desde “Más acciones”.
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
        <div className="lg:col-span-2 space-y-4 sm:space-y-5 min-w-0">
          <CurrentContractCard item={detail} today={ctx.today} propertyId={p.id} />
          <ContractsHistoryCard contracts={detail.contracts} excludeId={detail.current?.id} />
          <Suspense fallback={<SectionSkeleton height="h-48" />}>
            <ExpensesSection propertyId={p.id} />
          </Suspense>
          <Suspense fallback={<DocumentsSectionSkeleton />}>
            <DocumentsSection scope={{ propertyId: p.id }} />
          </Suspense>
        </div>
        <div className="space-y-4 sm:space-y-5 min-w-0">
          <OwnersCard owners={detail.owners} />
          <MandateCard property={p} />
          <ServicesCard services={p.services} />
          <ConsortiumCard property={p} />
          {p.notes && (
            <Card className="p-4 sm:p-5 gap-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <NotebookPen size={15} className="text-muted-foreground" /> Notas internas
              </h2>
              <p className="text-sm whitespace-pre-wrap text-amber-800 dark:text-amber-200">{p.notes}</p>
            </Card>
          )}
          <PropertyEventsCard events={detail.events} tz={ctx.tz} />
        </div>
      </div>
    </div>
  );
}
