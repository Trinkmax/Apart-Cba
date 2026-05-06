import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { listParteDiarioRecipients } from "@/lib/actions/parte-diario";
import { Button } from "@/components/ui/button";
import { RecipientsManager } from "@/components/parte-diario/recipients-manager";

export const dynamic = "force-dynamic";

export default async function ParteDiarioDestinatariosPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) redirect("/dashboard");

  const recipients = await listParteDiarioRecipients();

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5 max-w-3xl">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild className="size-7">
            <Link href="/dashboard/parte-diario" aria-label="Volver">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">Destinatarios del parte diario</h1>
        </div>
        <p className="text-sm text-muted-foreground pl-9">
          Quién recibe el PDF cada noche por WhatsApp. El primer envío crea el contacto en el CRM.
        </p>
      </header>

      <RecipientsManager initial={recipients} />
    </div>
  );
}
