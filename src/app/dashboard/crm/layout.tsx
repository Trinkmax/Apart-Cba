import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/actions/org";
import { canAny } from "@/lib/permissions";

export default async function CrmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { role } = await getCurrentOrg();

  // Solo roles con al menos 1 permiso CRM ven la sección.
  // Admin tiene "*"; recepción tiene crm_inbox y crm_rapidos.
  const allowed = canAny(role, [
    ["crm_inbox", "view"],
    ["crm_workflows", "view"],
    ["crm_rapidos", "view"],
    ["crm_config", "view"],
  ]);

  if (!allowed) redirect("/sin-acceso");

  return <>{children}</>;
}
