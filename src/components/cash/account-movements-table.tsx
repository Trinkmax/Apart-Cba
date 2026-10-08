"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Link2, History, Building, User2, BedDouble } from "lucide-react";
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
import { CATEGORY_SHORT_LABELS, Highlight, PartyTag, PlaceTag, movementTitle } from "./movement-display";
import type { CashAccount, Unit } from "@/lib/types/database";
import type { CashMovementAuditEntry, CashMovementListRow } from "@/lib/actions/cash";

const BILLABLE_BADGE: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
  apartcba: {
    icon: <Building size={9} />,
    label: "Organización",
    cls: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  owner: {
    icon: <User2 size={9} />,
    label: "Propietario",
    cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  guest: {
    icon: <BedDouble size={9} />,
    label: "Huésped",
    cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};


interface Props {
  rows: CashMovementListRow[];
  accounts: CashAccount[];
  units: Pick<Unit, "id" | "code" | "name">[];
  accountCurrency: string;
  latestAudit?: Record<string, CashMovementAuditEntry>;
  /** Tokens ya normalizados de la búsqueda (?q=), para resaltar lo que coincidió. */
  highlight?: string[];
  /** Lo que se tipeó, tal cual: para ofrecer buscarlo en todas las cuentas. */
  searchQuery?: string;
}

export function AccountMovementsTable({
  rows,
  accounts,
  units,
  accountCurrency,
  latestAudit,
  highlight,
  searchQuery,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    const q = searchQuery?.trim();
    return (
      <Card className="p-12 gap-2 text-center border-dashed text-sm text-muted-foreground">
        <p>{q ? `Nada con «${q}» en esta cuenta.` : "Sin movimientos para los filtros seleccionados."}</p>
        {q && (
          <p className="text-xs">
            Puede estar en otra cuenta:{" "}
            <Link
              href={`/dashboard/caja?q=${encodeURIComponent(q)}`}
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              buscar «{q}» en todas las cuentas
            </Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="divide-y">
          {/* Header desktop */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <div className="col-span-1">Tipo</div>
            <div className="col-span-4">Concepto</div>
            <div className="col-span-2">Categoría</div>
            <div className="col-span-1">Depto</div>
            <div className="col-span-2 text-right">Importe</div>
            <div className="col-span-2 text-right">Saldo</div>
          </div>

          {rows.map((m) => {
            const isIn = m.direction === "in";
            const isTransfer = m.category === "transfer";
            const hasLink = !!m.ref_type;
            const auditEntry = latestAudit?.[m.id];
            const { title, partyInTitle } = movementTitle(m);
            const party = m.party_name && !partyInTitle ? m.party_name : null;

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
                aria-label={`Ver detalle del movimiento ${title}`}
              >
                {/* MOBILE */}
                <div className="md:hidden flex items-start gap-3 p-3">
                  <div className={iconCls}>{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium truncate">
                        <Highlight text={title} tokens={highlight} />
                      </div>
                      <div className={cn(amountCls, "text-sm shrink-0")}>
                        {isIn ? "+" : "−"} {formatMoney(m.amount, m.currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="font-normal text-[10px] h-4 px-1.5">
                        {CATEGORY_SHORT_LABELS[m.category] ?? m.category}
                      </Badge>
                      {m.billable_to && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded",
                            BILLABLE_BADGE[m.billable_to].cls
                          )}
                        >
                          {BILLABLE_BADGE[m.billable_to].icon}
                          {BILLABLE_BADGE[m.billable_to].label}
                        </span>
                      )}
                      {hasLink && <Link2 size={10} className="opacity-60" />}
                      {m.place_label && (
                        <PlaceTag
                          label={m.place_label}
                          detail={m.unit?.name}
                          tokens={highlight}
                          className="max-w-[45%] text-foreground/80"
                        />
                      )}
                      {party && (
                        <PartyTag name={party} kind={m.party_kind} tokens={highlight} className="max-w-[60%]" />
                      )}
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
                      <Highlight text={title} tokens={highlight} />
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0">{formatDateTime(m.occurred_at)}</span>
                      {party && (
                        <>
                          <span aria-hidden>·</span>
                          <PartyTag name={party} kind={m.party_kind} tokens={highlight} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="font-normal text-[10px]">
                      {CATEGORY_SHORT_LABELS[m.category] ?? m.category}
                    </Badge>
                    {m.billable_to && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded",
                              BILLABLE_BADGE[m.billable_to].cls
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {BILLABLE_BADGE[m.billable_to].icon}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <span className="text-[11px]">Imputado a {BILLABLE_BADGE[m.billable_to].label}</span>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {auditEntry && <AuditStamp entry={auditEntry} />}
                  </div>
                  <div className="col-span-1 text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                    {hasLink && <Link2 size={10} className="opacity-60 shrink-0" />}
                    {m.place_label && (
                      <PlaceTag label={m.place_label} detail={m.unit?.name} tokens={highlight} className="max-w-full" />
                    )}
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
