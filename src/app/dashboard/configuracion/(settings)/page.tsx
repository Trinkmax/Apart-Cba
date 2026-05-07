import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { OrganizationProfileForm } from "@/components/settings/organization-profile-form";

export default async function GeneralConfigPage() {
  const { organization, role } = await getCurrentOrg();
  if (role !== "admin") redirect("/dashboard");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          General
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Información de la organización: nombre, datos fiscales, color y logo.
        </p>
      </header>
      <OrganizationProfileForm organization={organization} />
    </section>
  );
}
