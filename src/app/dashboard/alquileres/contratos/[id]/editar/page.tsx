import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/rentals/ui";
import { ContractWizard } from "@/components/rentals/contracts/contract-wizard";
import { wizardStateFromContract } from "@/components/rentals/contracts/wizard-state";
import { formatDate } from "@/lib/format";
import { formatContractNumber } from "@/lib/rentals/labels";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadContractForEdit, loadContractFormOptions } from "@/lib/rentals/server/contracts-queries";

export const metadata = { title: "Editar contrato · rentOS" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRentalsPage("update");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [data, options] = await Promise.all([loadContractForEdit(ctx, id), loadContractFormOptions(ctx)]);
  if (!data) notFound();
  const c = data.contract;
  const label = formatContractNumber(c.number);
  const backHref = `/dashboard/alquileres/contratos/${id}`;

  if (c.status === "finalizado" || c.status === "rescindido") {
    return (
      <div className="page-x page-y space-y-4 max-w-2xl mx-auto">
        <Card className="p-8 items-center text-center gap-3">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-base font-semibold">El contrato {label} ya terminó</p>
            <p className="text-sm text-muted-foreground mt-1">
              {c.status === "rescindido" ? "Se rescindió" : "Se finalizó"}
              {c.terminated_at ? ` el ${formatDate(c.terminated_at)}` : ""}: ya no se puede editar. Si siguen juntos, armá una renovación desde la ficha.
            </p>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link href={backHref}>
              <ArrowLeft size={14} /> Volver al contrato
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const initial = wizardStateFromContract(c, data.parties, data.overrides);
  const subtitle =
    c.status === "borrador"
      ? "Es un borrador: podés cambiar todo."
      : data.hasPayments
        ? "Ya tiene cobros: las fechas, el precio y el ajuste quedan fijos. El resto lo podés cambiar."
        : "Está vigente: si cambiás condiciones económicas, se recalculan los ajustes y los cargos impagos.";

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-[1280px] mx-auto">
      <PageHeader icon={Pencil} title={`Editar ${label}`} subtitle={subtitle} backHref={backHref} backLabel="Volver al contrato" />
      <ContractWizard
        mode="edit"
        contractId={id}
        contractStatus={c.status}
        contractLabel={label}
        initial={initial}
        options={options}
        hasPayments={data.hasPayments}
      />
    </div>
  );
}
