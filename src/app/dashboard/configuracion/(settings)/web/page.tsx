import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { isAdminLevel } from "@/lib/permissions";
import { getWebSettingsForCurrentOrg } from "@/lib/actions/web-settings";
import { WebSettingsForm, type WebSettingsFormInitial } from "@/components/settings/web-settings-form";
import { DEFAULT_RESPONSE_HOURS } from "@/lib/marketplace/web-settings";
import { DEFAULT_DEPOSIT_POLICY } from "@/lib/marketplace/sena";

export const dynamic = "force-dynamic";

/**
 * Configuración → Web y cobros. Lo que ve el huésped en la web: cómo te
 * contacta, cuánto seña y a dónde transfiere. Sólo admin (el layout del grupo
 * ya lo exige; se repite acá por si la página se mueve de grupo).
 */
export default async function WebSettingsPage() {
  const { role } = await getCurrentOrg();
  if (!isAdminLevel(role)) redirect("/dashboard");

  const { settings, orgContactEmail } = await getWebSettingsForCurrentOrg();

  const initial: WebSettingsFormInitial = {
    whatsapp_number: settings?.whatsapp_number ?? "",
    public_email: settings?.public_email ?? "",
    instagram_handle: settings?.instagram_handle ?? "",
    response_hours: String(settings?.response_hours ?? DEFAULT_RESPONSE_HOURS),
    deposit_rule: settings?.deposit_rule ?? DEFAULT_DEPOSIT_POLICY.rule,
    deposit_percent: settings?.deposit_percent != null ? String(settings.deposit_percent) : "",
    deposit_due_hours: String(settings?.deposit_due_hours ?? DEFAULT_DEPOSIT_POLICY.dueHours),
    transfer_holder: settings?.transfer_holder ?? "",
    transfer_cuit: settings?.transfer_cuit ?? "",
    transfer_bank: settings?.transfer_bank ?? "",
    transfer_cbu: settings?.transfer_cbu ?? "",
    transfer_alias: settings?.transfer_alias ?? "",
    transfer_notes: settings?.transfer_notes ?? "",
    cancellation_text: settings?.cancellation_text ?? "",
  };

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Web y cobros</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Lo que ve el huésped en la web: cómo te contacta, cuánto seña y a dónde transfiere.
        </p>
      </header>
      <WebSettingsForm initial={initial} orgContactEmail={orgContactEmail} />
    </section>
  );
}
