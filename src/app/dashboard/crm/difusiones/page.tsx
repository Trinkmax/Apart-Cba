import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { listBroadcasts } from "@/lib/actions/crm-broadcasts";
import { listChannels } from "@/lib/actions/crm-channels";
import { listTemplates } from "@/lib/actions/crm-templates";
import { DifusionesClient } from "@/components/crm/difusiones/difusiones-client";

export const dynamic = "force-dynamic";

export default async function DifusionesPage() {
  const { role } = await getCurrentOrg();
  if (role !== "admin") redirect("/sin-acceso");

  const [broadcasts, channels, templates] = await Promise.all([
    listBroadcasts(),
    listChannels(),
    listTemplates(),
  ]);
  return <DifusionesClient broadcasts={broadcasts} channels={channels} templates={templates} />;
}
