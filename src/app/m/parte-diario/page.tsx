import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { getParteDiarioForUser } from "@/lib/actions/parte-diario";
import { MobileBriefing } from "@/components/parte-diario/mobile-briefing";

export const dynamic = "force-dynamic";

export default async function MobileParteDiarioPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "parte_diario", "view")) redirect("/m");

  const payload = await getParteDiarioForUser();

  return (
    <div className="p-4">
      <MobileBriefing payload={payload} />
    </div>
  );
}
