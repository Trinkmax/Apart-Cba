import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { CommissionSettingsForm } from "@/components/settings/commission-settings-form";

export default async function ComisionesPage() {
  const { organization, role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Comisiones</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Lo que se lleva cada plataforma por vender, y lo que te quedás vos por
          administrar. Con esto, cada reserva sabe cuánto va al propietario.
        </p>
      </header>
      <CommissionSettingsForm
        initial={{
          channel_commissions: organization.channel_commissions ?? {},
          commission_base: organization.commission_base ?? "net_of_channel",
          default_commission_pct: organization.default_commission_pct ?? 20,
          default_currency: organization.default_currency ?? "ARS",
        }}
      />
    </section>
  );
}
