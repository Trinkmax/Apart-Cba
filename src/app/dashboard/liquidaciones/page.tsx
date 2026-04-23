import Link from "next/link";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { listSettlements } from "@/lib/actions/settlements";
import { listOwners } from "@/lib/actions/owners";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GenerateSettlementDialog } from "@/components/settlements/generate-settlement-dialog";
import { formatMoney, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OwnerSettlement, Owner } from "@/lib/types/database";

const STATUS_META: Record<OwnerSettlement["status"], { label: string; color: string }> = {
  borrador: { label: "Borrador", color: "#94a3b8" },
  revisada: { label: "Revisada", color: "#3b82f6" },
  enviada: { label: "Enviada", color: "#a855f7" },
  pagada: { label: "Pagada", color: "#10b981" },
  disputada: { label: "Disputada", color: "#f59e0b" },
  anulada: { label: "Anulada", color: "#ef4444" },
};

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type SettlementWithOwner = OwnerSettlement & { owner: Pick<Owner, "id" | "full_name" | "email" | "preferred_currency"> };

export default async function LiquidacionesPage() {
  const [settlements, owners] = await Promise.all([listSettlements(), listOwners()]);
  const ss = settlements as SettlementWithOwner[];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="size-5 text-primary" /> Liquidaciones
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ss.length} liquidaciones generadas
          </p>
        </div>
        <GenerateSettlementDialog owners={owners}>
          <Button className="gap-2"><Plus size={16} /> Generar liquidación</Button>
        </GenerateSettlementDialog>
      </div>

      {ss.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin liquidaciones</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generá la primera para un propietario en un período específico
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y">
            {ss.map((s) => {
              const meta = STATUS_META[s.status];
              return (
                <Link
                  key={s.id}
                  href={`/dashboard/liquidaciones/${s.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors group"
                >
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                      {getInitials(s.owner.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{s.owner.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {MONTH_NAMES[s.period_month - 1]} {s.period_year}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Neto a pagar</div>
                    <div className={cn(
                      "font-semibold tabular-nums",
                      s.net_payable >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}>
                      {formatMoney(s.net_payable, s.currency)}
                    </div>
                  </div>
                  <Badge
                    className="font-normal gap-1.5"
                    style={{ color: meta.color, backgroundColor: meta.color + "15", borderColor: meta.color + "30" }}
                  >
                    <span className="status-dot" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </Badge>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
