"use client";

import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Movement {
  id: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_at: string;
  account: { id: string; name: string; currency: string; color: string | null } | null;
  unit: { id: string; code: string; name: string } | null;
  owner: { id: string; full_name: string } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  booking_payment: "Reserva",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  salary: "Sueldo",
  utilities: "Servicios",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  refund: "Devolución",
  other: "Otro",
};

export function MovementsList({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
        No hay movimientos registrados
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {movements.map((m) => {
          const isIn = m.direction === "in";
          const isTransfer = m.category === "transfer";
          const iconCls = cn(
            "size-8 rounded-lg flex items-center justify-center shrink-0",
            isTransfer
              ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
              : isIn
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          );
          const amountCls = cn(
            "font-semibold tabular-nums whitespace-nowrap",
            isIn ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          );
          const icon = isTransfer ? <ArrowRightLeft size={14} /> : isIn ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />;
          return (
            <div key={m.id} className="hover:bg-accent/30 transition-colors">
              {/* MOBILE */}
              <div className="md:hidden flex items-start gap-3 p-3">
                <div className={iconCls}>{icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium truncate">
                      {m.description ?? CATEGORY_LABELS[m.category] ?? m.category}
                    </div>
                    <div className={cn(amountCls, "text-sm shrink-0")}>
                      {isIn ? "+" : "−"} {formatMoney(m.amount, m.currency)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="font-normal text-[10px] h-4 px-1.5">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </Badge>
                    {m.account && (
                      <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: m.account.color ?? "#0F766E" }} />
                        {m.account.name}
                      </span>
                    )}
                    {m.unit && <span className="font-mono">{m.unit.code}</span>}
                    {m.owner && <span className="truncate">{m.owner.full_name}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(m.occurred_at)}</div>
                </div>
              </div>

              {/* DESKTOP */}
              <div className="hidden md:grid grid-cols-12 items-center gap-3 p-3">
                <div className="col-span-1 flex items-center">
                  <div className={iconCls}>{icon}</div>
                </div>
                <div className="col-span-4 min-w-0">
                  <div className="text-sm font-medium truncate">{m.description ?? CATEGORY_LABELS[m.category] ?? m.category}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(m.occurred_at)}</div>
                </div>
                <div className="col-span-3">
                  <Badge variant="secondary" className="font-normal text-[10px]">
                    {CATEGORY_LABELS[m.category] ?? m.category}
                  </Badge>
                  {m.account && (
                    <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: m.account.color ?? "#0F766E" }} />
                      {m.account.name}
                    </div>
                  )}
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  {m.unit && <span className="font-mono">{m.unit.code}</span>}
                  {m.owner && <span>{m.owner.full_name}</span>}
                </div>
                <div className="col-span-2 text-right">
                  <div className={amountCls}>
                    {isIn ? "+" : "−"} {formatMoney(m.amount, m.currency)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
