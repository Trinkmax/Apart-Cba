import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Building2, NotebookPen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { Money } from "@/components/rentals/ui";
import { DocumentsSection, DocumentsSectionSkeleton } from "@/components/rentals/documents/documents-section";
import { PersonActions } from "@/components/rentals/people/person-actions";
import { ContactButtons, PersonContractsCard, PersonDataCard, WorkIncomeCard } from "@/components/rentals/people/person-cards";
import { getPerson } from "@/lib/actions/rentals-people";
import { getInitials } from "@/lib/format";
import { formatContractNumber } from "@/lib/rentals/labels";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { DetailError } from "@/components/rentals/properties/detail-error";

export const metadata = { title: "Inquilino o garante · rentOS" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRentalsPage();
  const { id } = await params;
  const res = await getPerson(id);
  if (!res.ok) {
    if (res.error.startsWith("No encontramos")) notFound();
    return <DetailError backHref="/dashboard/alquileres/personas" backLabel="Inquilinos y garantes" message={res.error} />;
  }
  const { person: p, links } = res.detail;
  const live = links.filter((l) => l.status === "vigente");
  const isTenant = live.some((l) => l.role === "inquilino");
  const isGuarantor = live.some((l) => l.role === "garante");
  const roleLabel = [isTenant ? "Inquilino" : null, isGuarantor ? "Garante" : null].filter(Boolean).join(" y ") || (links.length ? "Sin contrato vigente" : "Sin contratos");
  const debts = live.filter((l) => l.role === "inquilino" && l.overdue > 0.004);
  const guaranteedDebts = live.filter((l) => l.role === "garante" && l.overdue > 0.004);

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-5xl mx-auto">
      <LiveRefresh tables={["rental_contracts", "rental_charges", "rental_payments"]} label="cambio" labelPlural="cambios" throttleMs={5_000} />
      <Link href="/dashboard/alquileres/personas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Inquilinos y garantes
      </Link>

      <Card className="p-4 sm:p-6 gap-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <span className="size-14 sm:size-16 rounded-2xl bg-teal-600/10 text-teal-700 dark:text-teal-300 flex items-center justify-center text-lg sm:text-xl font-semibold shrink-0">
            {p.person_type === "juridica" ? <Building2 size={26} /> : getInitials(p.full_name)}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight break-words">{p.full_name}</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {p.person_type === "juridica" ? "Empresa" : "Persona"} · {roleLabel}
                {!p.active && " · Archivada"}
              </p>
            </div>
            <ContactButtons person={p} />
          </div>
          <PersonActions person={p} intent={isGuarantor && !isTenant ? "garante" : isTenant ? "inquilino" : undefined} />
        </div>
      </Card>

      {(debts.length > 0 || guaranteedDebts.length > 0) && (
        <div className="space-y-2">
          {debts.map((l) => (
            <div key={l.contract_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5">
              <p className="text-sm flex items-center gap-2">
                <AlertTriangle size={15} className="text-rose-500 shrink-0" />
                <span>
                  Debe <Money amount={l.overdue} currency={l.currency} tone="out" className="font-semibold" /> vencido en {l.property?.address ?? formatContractNumber(l.number)}.
                </span>
              </p>
              <Link href={`/dashboard/alquileres/contratos/${l.contract_id}?tab=cuenta`} className="text-xs font-medium text-rose-700 dark:text-rose-300 hover:underline">
                Ver la cuenta corriente
              </Link>
            </div>
          ))}
          {guaranteedDebts.map((l) => (
            <div key={`g-${l.contract_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
              <p className="text-sm flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500 shrink-0" />
                <span>
                  Es garante de {l.tenant_name ?? "un contrato"}, que debe <Money amount={l.overdue} currency={l.currency} className="font-semibold" /> vencido.
                </span>
              </p>
              <Link href={`/dashboard/alquileres/contratos/${l.contract_id}`} className="text-xs font-medium text-amber-800 dark:text-amber-200 hover:underline">
                Ver el contrato
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
        <div className="lg:col-span-2 space-y-4 sm:space-y-5 min-w-0">
          <PersonContractsCard links={links} />
          <Suspense fallback={<DocumentsSectionSkeleton />}>
            <DocumentsSection scope={{ personId: p.id }} />
          </Suspense>
        </div>
        <div className="space-y-4 sm:space-y-5 min-w-0">
          <PersonDataCard person={p} today={ctx.today} />
          <WorkIncomeCard person={p} links={links} />
          {p.notes && (
            <Card className="p-4 sm:p-5 gap-2">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <NotebookPen size={15} className="text-muted-foreground" /> Notas internas
              </h2>
              <p className="text-sm whitespace-pre-wrap text-amber-800 dark:text-amber-200">{p.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
