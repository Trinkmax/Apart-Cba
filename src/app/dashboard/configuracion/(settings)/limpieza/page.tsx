import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { DEFAULT_CHECKLIST } from "@/lib/cleaning/default-checklist";
import { CleaningChecklistForm } from "@/components/settings/cleaning-checklist-form";

export default async function LimpiezaSettingsPage() {
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Limpieza</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          La lista de control que ve quien limpia en cada departamento. Podés agregar,
          sacar y reordenar los ítems.
        </p>
      </header>
      <CleaningChecklistForm
        initialItems={organization.cleaning_checklist ?? []}
        defaultItems={[...DEFAULT_CHECKLIST]}
      />
    </section>
  );
}
