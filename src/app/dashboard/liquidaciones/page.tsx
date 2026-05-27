import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { listSettlements } from "@/lib/actions/settlements";
import { listOwners } from "@/lib/actions/owners";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { GenerateSettlementDialog } from "@/components/settlements/generate-settlement-dialog";
import { SettlementsViewTabs } from "@/components/settlements/settlements-view-tabs";
import { SettlementsListClient } from "@/components/settlements/settlements-list-client";
import type { OwnerSettlement, Owner } from "@/lib/types/database";

type SettlementWithOwner = OwnerSettlement & {
  owner: Pick<Owner, "id" | "full_name" | "email" | "preferred_currency">;
};

export default async function LiquidacionesPage() {
  const { role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) redirect("/dashboard");
  const [settlements, owners] = await Promise.all([
    listSettlements(),
    listOwners(),
  ]);
  const ss = settlements as SettlementWithOwner[];
  const pendientes = ss.filter((s) =>
    ["borrador", "revisada", "enviada"].includes(s.status),
  ).length;

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="size-5 text-primary" /> Liquidaciones
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {ss.length} generadas · {pendientes} pendientes de pago
          </p>
        </div>
        <GenerateSettlementDialog owners={owners} />
      </div>

      <SettlementsViewTabs />

      {ss.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin liquidaciones</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generá la primera para un propietario, o usá la vista{" "}
            <span className="font-medium">Por período</span> para hacerlas en
            lote.
          </p>
        </Card>
      ) : (
        <SettlementsListClient settlements={ss} />
      )}
    </div>
  );
}
