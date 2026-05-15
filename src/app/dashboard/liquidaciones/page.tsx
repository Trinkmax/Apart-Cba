import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { listSettlements } from "@/lib/actions/settlements";
import { listOwners } from "@/lib/actions/owners";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GenerateSettlementDialog } from "@/components/settlements/generate-settlement-dialog";
import { SettlementsViewTabs } from "@/components/settlements/settlements-view-tabs";
import { formatMoney, getInitials } from "@/lib/format";
import { formatPeriod, SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
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
        <GenerateSettlementDialog owners={owners}>
          <Button className="gap-2">
            <Plus size={16} />{" "}
            <span className="hidden sm:inline">Generar liquidación</span>
            <span className="sm:hidden">Generar</span>
          </Button>
        </GenerateSettlementDialog>
      </div>

      <SettlementsViewTabs active="propietario" />

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
        <Card className="overflow-hidden">
          <div className="divide-y">
            {ss.map((s) => {
              const meta =
                SETTLEMENT_STATUS_META[
                  s.status as keyof typeof SETTLEMENT_STATUS_META
                ];
              return (
                <Link
                  key={s.id}
                  href={`/dashboard/liquidaciones/${s.id}`}
                  className="flex items-center gap-3 p-3 sm:p-4 hover:bg-accent/30 transition-colors group"
                >
                  <Avatar className="size-9 sm:size-10 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {getInitials(s.owner.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {s.owner.full_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatPeriod(s.period_year, s.period_month)}
                    </div>
                    <Badge
                      className="font-normal gap-1.5 mt-1 sm:hidden text-[10px] h-4 px-1.5"
                      style={{
                        color: meta.color,
                        backgroundColor: meta.color + "15",
                        borderColor: meta.color + "30",
                      }}
                    >
                      <span
                        className="status-dot"
                        style={{ backgroundColor: meta.color }}
                      />
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] sm:text-xs text-muted-foreground">
                      Neto
                    </div>
                    <div
                      className={cn(
                        "font-semibold tabular-nums text-sm sm:text-base",
                        s.net_payable >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {formatMoney(s.net_payable, s.currency)}
                    </div>
                  </div>
                  <Badge
                    className="hidden sm:inline-flex font-normal gap-1.5"
                    style={{
                      color: meta.color,
                      backgroundColor: meta.color + "15",
                      borderColor: meta.color + "30",
                    }}
                  >
                    <span
                      className="status-dot"
                      style={{ backgroundColor: meta.color }}
                    />
                    {meta.label}
                  </Badge>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
                  />
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
