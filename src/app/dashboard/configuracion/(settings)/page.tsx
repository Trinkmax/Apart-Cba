import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { OrganizationProfileForm } from "@/components/settings/organization-profile-form";
import { IdentitySection } from "@/components/settings/org/identity-section";

export default async function GeneralConfigPage() {
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
          Organización
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Logo, nombre, datos fiscales, color de marca y contacto público.
        </p>
      </header>
      <OrganizationProfileForm organization={organization} />
      <IdentitySection organization={organization} />
    </section>
  );
}
