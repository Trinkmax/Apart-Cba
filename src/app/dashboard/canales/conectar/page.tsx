import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Cable } from "lucide-react";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getChannelsOverview } from "@/lib/actions/channels";
import { ConnectWizard } from "@/components/canales/connect-wizard";

export const dynamic = "force-dynamic";

export default async function ConectarPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const { role } = await getCurrentOrg();
  if (!can(role, "channels", "update")) redirect("/dashboard/canales");
  const { link } = await searchParams;
  const overview = await getChannelsOverview();

  return (
    <div className="page-x page-y space-y-4 max-w-4xl mx-auto">
      <Link
        href="/dashboard/canales"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Canales de venta
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Cable className="size-5 text-primary" />
          Conectar departamentos
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          El asistente guarda el avance: podés salir y retomar cuando quieras.
        </p>
      </div>
      <ConnectWizard units={overview.units} links={overview.links} focusLinkId={link} />
    </div>
  );
}
