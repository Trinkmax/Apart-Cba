"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, FileText, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettlementDeleteButton } from "@/components/settlements/settlement-delete-button";
import { formatMoney, getInitials } from "@/lib/format";
import { formatPeriod, SETTLEMENT_STATUS_META } from "@/lib/settlements/labels";
import { cn } from "@/lib/utils";
import type {
  OwnerSettlement,
  Owner,
  SettlementStatus,
} from "@/lib/types/database";

type SettlementWithOwner = OwnerSettlement & {
  owner: Pick<Owner, "id" | "full_name" | "email" | "preferred_currency">;
};

type StatusFilter = SettlementStatus | "all";

const STATUS_ORDER: SettlementStatus[] = [
  "borrador",
  "revisada",
  "enviada",
  "pagada",
  "disputada",
  "anulada",
];

interface Props {
  settlements: SettlementWithOwner[];
}

export function SettlementsListClient({ settlements }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const statusCounts = useMemo(() => {
    const counts = new Map<SettlementStatus, number>();
    for (const s of settlements) {
      counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    }
    return counts;
  }, [settlements]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return settlements.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      const period = formatPeriod(s.period_year, s.period_month).toLowerCase();
      const status =
        SETTLEMENT_STATUS_META[
          s.status as keyof typeof SETTLEMENT_STATUS_META
        ]?.label.toLowerCase() ?? "";
      return (
        s.owner.full_name.toLowerCase().includes(q) ||
        period.includes(q) ||
        String(s.period_year).includes(q) ||
        status.includes(q)
      );
    });
  }, [settlements, query, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative w-40 sm:w-56 shrink-0">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Buscar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div
          role="tablist"
          aria-label="Filtrar por estado"
          className="flex items-center gap-1 flex-nowrap overflow-x-auto min-w-0 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <StatusChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="Todas"
            count={settlements.length}
          />
          {STATUS_ORDER.map((s) => {
            const count = statusCounts.get(s) ?? 0;
            if (count === 0) return null;
            const meta = SETTLEMENT_STATUS_META[s];
            return (
              <StatusChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                label={meta.label}
                count={count}
                color={meta.color}
              />
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">Sin resultados</p>
          <p className="text-xs text-muted-foreground mt-1">
            {statusFilter !== "all" || query
              ? "Probá con otro propietario, período o estado."
              : "Aún no hay liquidaciones."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y">
            {filtered.map((s) => {
              const meta =
                SETTLEMENT_STATUS_META[
                  s.status as keyof typeof SETTLEMENT_STATUS_META
                ];
              return (
                <div
                  key={s.id}
                  className="flex items-center group hover:bg-accent/30 transition-colors"
                >
                  <Link
                    href={`/dashboard/liquidaciones/${s.id}`}
                    className="flex items-center gap-3 p-3 sm:p-4 flex-1 min-w-0"
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
                  <div className="pr-2 sm:pr-3 shrink-0">
                    <SettlementDeleteButton
                      id={s.id}
                      ownerName={s.owner.full_name}
                      period={formatPeriod(s.period_year, s.period_month)}
                      paid={s.status === "pagada" || !!s.paid_movement_id}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={
        active && color
          ? {
              color,
              backgroundColor: color + "15",
              borderColor: color + "40",
            }
          : undefined
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 h-7 rounded-full border px-2 text-[11px] font-medium transition-colors",
        active
          ? color
            ? ""
            : "bg-foreground text-background border-foreground"
          : "bg-card text-muted-foreground border-input hover:text-foreground hover:bg-accent/40",
      )}
    >
      {color && (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <span
        className={cn(
          "tabular-nums text-[10px] font-normal",
          active ? "opacity-80" : "opacity-60",
        )}
      >
        {count}
      </span>
    </button>
  );
}
