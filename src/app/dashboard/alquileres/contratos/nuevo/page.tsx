import { FilePlus2 } from "lucide-react";
import { PageHeader } from "@/components/rentals/ui";
import { ContractWizard } from "@/components/rentals/contracts/contract-wizard";
import { defaultWizardState, newPartyKey } from "@/components/rentals/contracts/wizard-state";
import { requireRentalsPage } from "@/lib/rentals/server/access";
import { loadContractFormOptions } from "@/lib/rentals/server/contracts-queries";

export const metadata = { title: "Nuevo contrato · rentOS" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Alta de contrato. Acepta `?propiedad=<id>` y `?inquilino=<id>` para llegar
 * con la propiedad o el inquilino ya elegidos (desde sus fichas).
 */
export default async function NewContractPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireRentalsPage("create");
  const [sp, options] = await Promise.all([searchParams, loadContractFormOptions(ctx)]);
  const initial = defaultWizardState(options.settings, ctx.today);

  const propertyId = first(sp.propiedad);
  const property = propertyId ? options.properties.find((p) => p.id === propertyId) : undefined;
  if (property) {
    initial.property_id = property.id;
    if (property.listingRent && (property.listingCurrency ?? "ARS") === "ARS") {
      initial.initial_rent = property.listingRent.toLocaleString("es-AR", { maximumFractionDigits: 2 });
    }
  }
  const personId = first(sp.inquilino);
  const person = personId ? options.people.find((p) => p.id === personId) : undefined;
  if (person) {
    initial.parties = [
      { key: newPartyKey(), person_id: person.id, role: "inquilino", is_primary: true, guarantee_type: null, guarantee_detail: "", guarantor_consent_at: "" },
    ];
  }
  const initialStep = property ? (person ? 2 : 1) : 0;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-[1280px] mx-auto">
      <PageHeader
        icon={FilePlus2}
        title="Nuevo contrato"
        subtitle="Ocho pasos cortos. Lo que vas cargando queda guardado en este navegador hasta que lo guardes."
        backHref="/dashboard/alquileres/contratos"
        backLabel="Contratos"
      />
      <ContractWizard mode="create" initial={initial} options={options} initialStep={initialStep} />
    </div>
  );
}
