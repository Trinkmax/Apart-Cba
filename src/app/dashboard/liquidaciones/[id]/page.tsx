import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSettlement } from "@/lib/actions/settlements";
import { getCurrentOrg } from "@/lib/actions/org";
import { can } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettlementActions } from "@/components/settlements/settlement-actions";
import { formatMoney, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OwnerSettlement, Owner, SettlementLine, Unit } from "@/lib/types/database";

const STATUS_META = {
  borrador: { label: "Borrador", color: "#94a3b8" },
  revisada: { label: "Revisada", color: "#3b82f6" },
  enviada: { label: "Enviada", color: "#a855f7" },
  pagada: { label: "Pagada", color: "#10b981" },
  disputada: { label: "Disputada", color: "#f59e0b" },
  anulada: { label: "Anulada", color: "#ef4444" },
};
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const LINE_TYPE_LABELS: Record<SettlementLine["line_type"], { label: string; color: string }> = {
  booking_revenue: { label: "Reserva", color: "#10b981" },
  commission: { label: "Comisión", color: "#a855f7" },
  cleaning_charge: { label: "Limpieza", color: "#06b6d4" },
  maintenance_charge: { label: "Mantenimiento", color: "#f97316" },
  adjustment: { label: "Ajuste", color: "#64748b" },
  monthly_rent_fraction: { label: "Renta mensual", color: "#7c3aed" },
  expenses_fraction: { label: "Expensas", color: "#a78bfa" },
};

type SettlementDetail = OwnerSettlement & {
  owner: Owner;
  lines: (SettlementLine & { unit: Pick<Unit, "id" | "code" | "name"> | null })[];
};

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await getCurrentOrg();
  if (!can(role, "settlements", "view")) redirect("/dashboard");
  const settlement = (await getSettlement(id)) as unknown as SettlementDetail | null;
  if (!settlement) notFound();
  const meta = STATUS_META[settlement.status];

  return (
    <div className="page-x page-y max-w-5xl mx-auto space-y-4 sm:space-y-5 md:space-y-6">
      <Link href="/dashboard/liquidaciones" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Volver
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
          <Avatar className="size-11 sm:size-14 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {getInitials(settlement.owner.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-semibold tracking-tight">
              {MONTHS[settlement.period_month - 1]} {settlement.period_year}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">{settlement.owner.full_name}</p>
            <Badge
              className="mt-2 font-normal gap-1.5"
              style={{ color: meta.color, backgroundColor: meta.color + "15", borderColor: meta.color + "30" }}
            >
              <span className="status-dot" style={{ backgroundColor: meta.color }} />
              {meta.label}
            </Badge>
          </div>
        </div>
        <SettlementActions settlement={settlement} />
      </div>

      {/* Resumen */}
      <Card className="p-4 sm:p-6 brand-gradient text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.1),transparent_60%)]" />
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div>
            <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">Bruto</div>
            <div className="text-base sm:text-lg font-semibold mt-1 truncate">{formatMoney(settlement.gross_revenue, settlement.currency)}</div>
          </div>
          <div>
            <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">Comisión</div>
            <div className="text-base sm:text-lg font-semibold mt-1 truncate">−{formatMoney(settlement.commission_amount, settlement.currency)}</div>
          </div>
          <div>
            <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">Otros gastos</div>
            <div className="text-base sm:text-lg font-semibold mt-1 truncate">−{formatMoney(settlement.deductions_amount, settlement.currency)}</div>
          </div>
          <div className="col-span-2 sm:col-span-1 sm:border-l sm:border-white/30 sm:pl-4 pt-3 sm:pt-0 border-t sm:border-t-0 border-white/30 sm:border-t-transparent">
            <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">Neto a transferir</div>
            <div className="text-xl sm:text-2xl font-bold mt-1 truncate">{formatMoney(settlement.net_payable, settlement.currency)}</div>
          </div>
        </div>
      </Card>

      {/* Líneas */}
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Detalle</h2>
        <div className="space-y-1">
          {settlement.lines.map((line) => {
            const lm = LINE_TYPE_LABELS[line.line_type];
            return (
              <div key={line.id} className="flex items-start sm:items-center gap-2.5 sm:gap-3 py-2 border-b border-border/40 last:border-0">
                <div className="size-1.5 rounded-full mt-2 sm:mt-0 shrink-0" style={{ backgroundColor: lm.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{line.description}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {line.unit && (
                      <span className="text-[11px] text-muted-foreground font-mono">{line.unit.code}</span>
                    )}
                    <Badge variant="secondary" className="text-[10px] font-normal sm:hidden h-4 px-1.5">{lm.label}</Badge>
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px] font-normal hidden sm:inline-flex">{lm.label}</Badge>
                <div className={cn(
                  "font-mono font-semibold tabular-nums text-right shrink-0 text-sm sm:text-base sm:w-32",
                  line.sign === "+" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                )}>
                  {line.sign === "+" ? "+" : "−"} {formatMoney(line.amount, settlement.currency)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Datos bancarios para transferir */}
      {settlement.owner.cbu || settlement.owner.alias_cbu ? (
        <Card className="p-4 sm:p-5 bg-muted/30">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Datos para transferir</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Banco</dt>
              <dd className="font-medium">{settlement.owner.bank_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">CBU</dt>
              <dd className="font-mono text-xs break-all select-all">{settlement.owner.cbu ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Alias</dt>
              <dd className="font-mono select-all">{settlement.owner.alias_cbu ?? "—"}</dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
