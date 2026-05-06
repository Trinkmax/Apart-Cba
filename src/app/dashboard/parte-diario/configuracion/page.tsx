import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import {
  getParteDiarioSettings,
  listMetaCloudChannels,
} from "@/lib/actions/parte-diario";
import { Button } from "@/components/ui/button";
import { SettingsForm } from "@/components/parte-diario/settings-form";

export const dynamic = "force-dynamic";

export default async function ParteDiarioConfigPage() {
  const { organization, role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "update")) redirect("/dashboard/parte-diario");

  const [settings, channels] = await Promise.all([
    getParteDiarioSettings(),
    listMetaCloudChannels(),
  ]);

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5 max-w-3xl pb-24">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="size-7">
            <Link href="/dashboard/parte-diario" aria-label="Volver">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Configuración del parte diario</h1>
        </div>
        <p className="text-sm text-muted-foreground pl-9">
          Cuándo se genera el borrador, cómo se asignan las limpiezas y por qué canal de WhatsApp se envía.
        </p>
      </header>

      <SettingsForm initial={settings} channels={channels} organizationName={organization.name} />
    </div>
  );
}
