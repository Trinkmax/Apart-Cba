import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { listOwnersForPeriod } from "@/lib/actions/settlements";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { PeriodBatchPanel } from "@/components/settlements/period-batch-panel";
import { SettlementsViewTabs } from "@/components/settlements/settlements-view-tabs";
import { formatPeriod } from "@/lib/settlements/labels";

export default async function LiquidacionesPeriodoPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; currency?: string }>;
}) {
  const { role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) redirect("/dashboard");

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const monthRaw = Number(sp.month) || now.getMonth() + 1;
  const month = Math.min(12, Math.max(1, monthRaw));
  const currency = sp.currency || "ARS";

  const data = await listOwnersForPeriod(year, month, currency);
  const canCreate = can(role, "settlements", "create");

  const rows = data.map((d) => ({
    owner: { id: d.owner.id, full_name: d.owner.full_name },
    units: d.units,
    settlement: d.settlement
      ? {
          id: d.settlement.id,
          status: d.settlement.status,
          net_payable: Number(d.settlement.net_payable),
          currency: d.settlement.currency,
        }
      : null,
  }));

  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="size-5 text-primary" /> Liquidaciones
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
            Generación por período · {formatPeriod(year, month)}
          </p>
        </div>
        <SettlementsViewTabs active="periodo" />
      </div>

      <PeriodBatchPanel
        year={year}
        month={month}
        currency={currency}
        rows={rows}
        canCreate={canCreate}
      />
    </div>
  );
}
