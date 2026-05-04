"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Receipt, Edit2, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatMoney, formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MovementDetailSheet } from "@/components/cash/movement-detail-sheet";
import type { CashAccount, Unit } from "@/lib/types/database";
import type { CashMovementAuditEntry, EnrichedMovement } from "@/lib/actions/cash";

const CATEGORY_LABELS: Record<string, string> = {
  booking_payment: "Cobro",
  refund: "Devolución",
  other: "Otro",
  adjustment: "Ajuste",
};

interface Props {
  movements: EnrichedMovement[];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  latestAudit?: Record<string, CashMovementAuditEntry>;
}

export function BookingPaymentsSection({ movements, accounts, units, latestAudit }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (movements.length === 0) {
    return (
      <Card className="p-4 border-dashed text-center">
        <p className="text-xs text-muted-foreground">
          Sin movimientos registrados todavía. Cargá un pago desde el botón de arriba.
        </p>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Receipt size={12} /> Movimientos ({movements.length})
        </h3>
        <span className="text-[10px] text-muted-foreground">Click para editar</span>
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y">
          {movements.map((m) => {
            const isIn = m.direction === "in";
            const auditEntry = latestAudit?.[m.id];
            const iconCls = cn(
              "size-7 rounded-lg flex items-center justify-center shrink-0",
              isIn
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            );
            const amountCls = cn(
              "font-semibold tabular-nums whitespace-nowrap text-sm",
              isIn ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            );
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenId(m.id)}
                className="w-full text-left flex items-start gap-2.5 p-2.5 hover:bg-accent/40 active:bg-accent/60 transition-colors group focus:outline-none focus:bg-accent/40"
                aria-label="Editar movimiento"
              >
                <div className={iconCls}>
                  {isIn ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium truncate">
                      {m.description ?? CATEGORY_LABELS[m.category] ?? m.category}
                    </div>
                    <div className={amountCls}>
                      {isIn ? "+" : "−"} {formatMoney(m.amount, m.currency)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10px] text-muted-foreground">
                    {m.account && (
                      <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: m.account.color ?? "#0F766E" }} />
                        {m.account.name}
                      </span>
                    )}
                    <Badge variant="secondary" className="font-normal text-[9px] h-3.5 px-1">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </Badge>
                    <span>{formatDateTime(m.occurred_at)}</span>
                    {auditEntry && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded",
                              auditEntry.action === "delete"
                                ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <History size={9} />
                            {auditEntry.actor_name.split(/\s+/)[0]}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs space-y-0.5">
                            <div className="font-semibold">{auditEntry.actor_name}</div>
                            <div className="text-muted-foreground">
                              {auditEntry.action === "delete" ? "Eliminó" : "Editó"} ·{" "}
                              {formatTimeAgo(auditEntry.occurred_at)}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatDateTime(auditEntry.occurred_at)}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <Edit2 size={12} className="text-muted-foreground/30 group-hover:text-primary transition-colors mt-1.5 shrink-0" />
              </button>
            );
          })}
        </div>
      </Card>

      <MovementDetailSheet
        open={openId !== null}
        movementId={openId}
        accounts={accounts}
        units={units}
        onClose={() => setOpenId(null)}
      />
    </TooltipProvider>
  );
}
