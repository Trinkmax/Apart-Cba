import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { InboxShell } from "@/components/crm/inbox/inbox-shell";

export const dynamic = "force-dynamic";

export default async function CrmInboxPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "crm_inbox", "view")) redirect("/sin-acceso");

  return <InboxShell />;
}
