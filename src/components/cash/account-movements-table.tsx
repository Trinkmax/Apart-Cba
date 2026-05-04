"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Link2, History } from "lucide-react";
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
import { MovementDetailSheet } from "./movement-detail-sheet";
import type { CashAccount, Unit } from "@/lib/types/database";
import type { CashMovementAuditEntry, EnrichedMovementRow } from "@/lib/actions/cash";

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

interface Props {
  rows: EnrichedMovementRow[];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  accountCurrency: string;
  latestAudit?: Record<string, CashMovementAuditEntry>;
}

export function AccountMovementsTable({ rows, accounts, units, accountCurrency, latestAudit }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
        Sin movimientos para los filtros seleccionados.
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="overflow-hidden">
        <div className="divide-y">
          {/* Header desktop */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <div className="col-span-1">Tipo</div>
            <div className="col-span-4">Concepto</div>
            <div className="col-span-2">Categoría</div>
            <div className="col-span-1">Vinculado</div>
            <div className="col-span-2 text-right">Importe</div>
            <div className="col-span-2 text-right">Saldo</div>
          </div>

          {rows.map((m) => {
            const isIn = m.direction === "in";
            const isTransfer = m.category === "transfer";
            const hasLink = !!m.ref_type;
            const auditEntry = latestAudit?.[m.id];

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
            const icon = isTransfer ? (
              <ArrowRightLeft size={14} />
            ) : isIn ? (
              <ArrowDownToLine size={14} />
            ) : (
              <ArrowUpFromLine size={14} />
            );

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenId(m.id)}
                className="w-full text-left hover:bg-accent/40 active:bg-accent/60 transition-colors focus:outline-none focus:bg-accent/40"
                aria-label={`Ver detalle del movimiento ${m.description ?? CATEGORY_LABELS[m.category]}`}
              >
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
                      {hasLink && <Link2 size={10} className="opacity-60" />}
                      {m.unit && <span className="font-mono">{m.unit.code}</span>}
                      {auditEntry && <AuditStamp entry={auditEntry} />}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                      <span>{formatDateTime(m.occurred_at)}</span>
                      <span className="tabular-nums">Saldo: {formatMoney(m.running_balance, accountCurrency)}</span>
                    </div>
                  </div>
                </div>

                {/* DESKTOP */}
                <div className="hidden md:grid grid-cols-12 items-center gap-3 px-4 py-3">
                  <div className="col-span-1 flex items-center"><div className={iconCls}>{icon}</div></div>
                  <div className="col-span-4 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.description ?? CATEGORY_LABELS[m.category] ?? m.category}
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(m.occurred_at)}</div>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="font-normal text-[10px]">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </Badge>
                    {auditEntry && <AuditStamp entry={auditEntry} />}
                  </div>
                  <div className="col-span-1 text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                    {hasLink && <Link2 size={10} className="opacity-60 shrink-0" />}
                    {m.unit && <span className="font-mono truncate">{m.unit.code}</span>}
                  </div>
                  <div className="col-span-2 text-right">
                    <div className={amountCls}>
                      {isIn ? "+" : "−"} {formatMoney(m.amount, m.currency)}
                    </div>
                  </div>
                  <div className="col-span-2 text-right text-sm tabular-nums text-muted-foreground">
                    {formatMoney(m.running_balance, accountCurrency)}
                  </div>
                </div>
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

function AuditStamp({ entry }: { entry: CashMovementAuditEntry }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded",
            entry.action === "delete"
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <History size={9} />
          {entry.actor_name.split(/\s+/)[0]}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs space-y-0.5">
          <div className="font-semibold">{entry.actor_name}</div>
          <div className="text-muted-foreground">
            {entry.action === "delete" ? "Eliminó" : "Editó"} · {formatTimeAgo(entry.occurred_at)}
          </div>
          <div className="text-[10px] text-muted-foreground">{formatDateTime(entry.occurred_at)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
