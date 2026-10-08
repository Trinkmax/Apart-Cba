"use client";

import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashMovementListRow } from "@/lib/actions/cash";
import { CATEGORY_SHORT_LABELS, Highlight, PartyTag, PlaceTag, movementTitle } from "./movement-display";

type Movement = Pick<
  CashMovementListRow,
  | "id"
  | "direction"
  | "amount"
  | "currency"
  | "category"
  | "description"
  | "occurred_at"
  | "account"
  | "unit"
  | "party_name"
  | "party_kind"
  | "place_label"
>;

export function MovementsList({
  movements,
  onSelect,
  highlight,
  emptyLabel = "No hay movimientos registrados",
}: {
  movements: Movement[];
  onSelect?: (id: string) => void;
  /** Tokens ya normalizados de la búsqueda, para resaltar lo que coincidió. */
  highlight?: string[];
  emptyLabel?: string;
}) {
  if (movements.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed text-sm text-muted-foreground">
        {emptyLabel}
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
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
          const { title, partyInTitle } = movementTitle(m);
          const party = m.party_name && !partyInTitle ? m.party_name : null;
          const category = CATEGORY_SHORT_LABELS[m.category] ?? m.category;
          return (
            <div
              key={m.id}
              className={cn(
                "hover:bg-accent/30 transition-colors",
                onSelect && "cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40",
              )}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `Ver detalle: ${title}` : undefined}
              onClick={onSelect ? () => onSelect(m.id) : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(m.id);
                      }
                    }
                  : undefined
              }
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
                  <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap mt-1 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="font-normal text-[10px] h-4 px-1.5">
                      {category}
                    </Badge>
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
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1">
                    <span>{formatDateTime(m.occurred_at)}</span>
                    {m.account && (
                      <span className="flex items-center gap-1 min-w-0">
                        <span aria-hidden>·</span>
                        <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: m.account.color ?? "#0F766E" }} />
                        <span className="truncate">{m.account.name}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* DESKTOP */}
              <div className="hidden md:grid grid-cols-12 items-center gap-3 p-3">
                <div className="col-span-1 flex items-center">
                  <div className={iconCls}>{icon}</div>
                </div>
                <div className="col-span-4 min-w-0">
                  <div className="text-sm font-medium truncate">
                    <Highlight text={title} tokens={highlight} />
                  </div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(m.occurred_at)}</div>
                </div>
                <div className="col-span-2 min-w-0">
                  <Badge variant="secondary" className="font-normal text-[10px]">
                    {category}
                  </Badge>
                  {m.account && (
                    <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 min-w-0">
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: m.account.color ?? "#0F766E" }} />
                      <span className="truncate">{m.account.name}</span>
                    </div>
                  )}
                </div>
                <div className="col-span-3 min-w-0 text-xs text-muted-foreground space-y-0.5">
                  {m.place_label && (
                    <PlaceTag
                      label={m.place_label}
                      detail={m.unit?.name}
                      tokens={highlight}
                      withIcon
                      className="max-w-full text-foreground/80"
                    />
                  )}
                  {party && (
                    <div className="min-w-0">
                      <PartyTag name={party} kind={m.party_kind} tokens={highlight} className="max-w-full" />
                    </div>
                  )}
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
