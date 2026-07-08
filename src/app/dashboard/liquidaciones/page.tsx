import { redirect } from "next/navigation";
import {
  listSettlements,
  listOwnersForPeriod,
} from "@/lib/actions/settlements";
import { listOwners } from "@/lib/actions/owners";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { LiquidacionesTabs } from "@/components/settlements/liquidaciones-tabs";
import type { OwnerSettlement, Owner } from "@/lib/types/database";

type SettlementWithOwner = OwnerSettlement & {
  owner: Pick<Owner, "id" | "full_name" | "email" | "preferred_currency">;
};

export default async function LiquidacionesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    year?: string;
    month?: string;
    currency?: string;
  }>;
}) {
  const { role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) redirect("/dashboard");

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const monthRaw = Number(sp.month) || now.getMonth() + 1;
  const month = Math.min(12, Math.max(1, monthRaw));
  const currency = sp.currency || "all";
  const initialTab = sp.tab === "periodo" ? "periodo" : "propietario";

  // Los tres fetches son independientes → en paralelo, la latencia total es la
  // del más lento (no la suma). Ambas vistas quedan listas en el cliente, así
  // alternar tabs no vuelve a pegarle al server.
  const [settlements, owners, periodData] = await Promise.all([
    listSettlements(),
    listOwners(),
    listOwnersForPeriod(year, month),
  ]);

  const ss = settlements as SettlementWithOwner[];
  const pendientes = ss.filter((s) =>
    ["borrador", "revisada", "enviada"].includes(s.status),
  ).length;

  const periodRows = periodData.map((d) => ({
    owner: { id: d.owner.id, full_name: d.owner.full_name },
    units: d.units,
    settlements: d.settlements.map((s) => ({
      id: s.id,
      status: s.status,
      net_payable: Number(s.net_payable),
      currency: s.currency,
    })),
  }));

  const canCreate = can(role, "settlements", "create");

  return (
    <div className="page-x page-y max-w-6xl mx-auto">
      <LiquidacionesTabs
        initialTab={initialTab}
        settlements={ss}
        owners={owners}
        pendientes={pendientes}
        year={year}
        month={month}
        currency={currency}
        periodRows={periodRows}
        canCreate={canCreate}
      />
    </div>
  );
}
