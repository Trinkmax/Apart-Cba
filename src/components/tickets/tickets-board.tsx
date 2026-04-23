"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, Wrench, CheckCircle2, Clock, Package, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TICKET_PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { formatTimeAgo, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MaintenanceTicket, Unit, TicketStatus } from "@/lib/types/database";

type TicketWithUnit = MaintenanceTicket & { unit: Pick<Unit, "id" | "code" | "name"> };

const COLUMNS: { key: TicketStatus; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: "abierto", icon: AlertTriangle },
  { key: "en_progreso", icon: Wrench },
  { key: "esperando_repuesto", icon: Package },
  { key: "resuelto", icon: CheckCircle2 },
];

export function TicketsBoard({ tickets }: { tickets: TicketWithUnit[] }) {
  const grouped = useMemo(() => {
    const map = new Map<TicketStatus, TicketWithUnit[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    tickets.forEach((t) => map.get(t.status as TicketStatus)?.push(t));
    map.forEach((list) =>
      list.sort((a, b) => {
        const wA = TICKET_PRIORITY_META[a.priority]?.weight ?? 0;
        const wB = TICKET_PRIORITY_META[b.priority]?.weight ?? 0;
        return wB - wA;
      })
    );
    return map;
  }, [tickets]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {COLUMNS.map((col) => {
        const items = grouped.get(col.key) ?? [];
        const meta = TICKET_STATUS_META[col.key];
        const Icon = col.icon;
        return (
          <Card key={col.key} className="bg-muted/30 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div
                  className="size-7 rounded-md flex items-center justify-center"
                  style={{ backgroundColor: meta.color + "20", color: meta.color }}
                >
                  <Icon size={14} />
                </div>
                <h3 className="font-semibold text-sm">{meta.label}</h3>
              </div>
              <Badge variant="secondary" className="font-mono">{items.length}</Badge>
            </div>
            <div className="space-y-2 min-h-[100px]">
              {items.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50 italic border border-dashed border-border/40 rounded-lg">
                  Sin tickets
                </div>
              ) : (
                items.map((t) => {
                  const pm = TICKET_PRIORITY_META[t.priority];
                  return (
                    <Link
                      key={t.id}
                      href={`/dashboard/mantenimiento/${t.id}`}
                      className="block p-3 bg-card rounded-lg border border-border hover:border-primary/30 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm leading-snug">{t.title}</div>
                        <Badge
                          className="text-[10px] gap-1 font-normal shrink-0"
                          style={{ color: pm.color, backgroundColor: pm.color + "15", borderColor: pm.color + "30" }}
                        >
                          {pm.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                        <Building2 size={11} />
                        <span className="font-mono">{t.unit.code}</span>
                        <span className="truncate">· {t.unit.name}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock size={10} /> {formatTimeAgo(t.opened_at)}</span>
                        {t.actual_cost !== null && t.actual_cost !== undefined && (
                          <span className="font-semibold text-foreground">
                            {formatMoney(t.actual_cost, t.cost_currency ?? "ARS")}
                          </span>
                        )}
                      </div>
                      {t.billable_to === "owner" && (
                        <Badge variant="outline" className="mt-2 text-[10px]">→ Owner</Badge>
                      )}
                    </Link>
                  );
                })
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
