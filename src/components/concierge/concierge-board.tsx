"use client";

import { useMemo, useTransition } from "react";
import { Clock, Sparkles, CheckCircle2, X, Bell, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { changeConciergeStatus } from "@/lib/actions/concierge";
import { formatTimeAgo, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConciergeRequest, ConciergeStatus, Unit, Guest, ConciergePriority } from "@/lib/types/database";

type CR = ConciergeRequest & {
  unit: Pick<Unit, "id" | "code" | "name"> | null;
  guest: Pick<Guest, "id" | "full_name"> | null;
};

const STATUS_META: Record<ConciergeStatus, { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  pendiente: { label: "Pendiente", color: "#94a3b8", icon: Clock },
  en_progreso: { label: "En progreso", color: "#3b82f6", icon: Sparkles },
  completada: { label: "Completada", color: "#10b981", icon: CheckCircle2 },
  rechazada: { label: "Rechazada", color: "#ef4444", icon: X },
  cancelada: { label: "Cancelada", color: "#64748b", icon: X },
};

const PRIORITY_COLOR: Record<ConciergePriority, string> = {
  baja: "#64748b",
  normal: "#3b82f6",
  alta: "#f59e0b",
  urgente: "#ef4444",
};

const COLUMNS: ConciergeStatus[] = ["pendiente", "en_progreso", "completada"];

export function ConciergeBoard({ requests }: { requests: CR[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const m = new Map<ConciergeStatus, CR[]>();
    COLUMNS.forEach((c) => m.set(c, []));
    requests.forEach((r) => m.get(r.status)?.push(r));
    return m;
  }, [requests]);

  function advance(r: CR) {
    const next: Record<ConciergeStatus, ConciergeStatus | null> = {
      pendiente: "en_progreso",
      en_progreso: "completada",
      completada: null,
      rechazada: null,
      cancelada: null,
    };
    const newStatus = next[r.status];
    if (!newStatus) return;
    startTransition(async () => {
      try {
        await changeConciergeStatus(r.id, newStatus);
        toast.success(`→ ${STATUS_META[newStatus].label}`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {COLUMNS.map((status) => {
        const items = grouped.get(status) ?? [];
        const meta = STATUS_META[status];
        const Icon = meta.icon;
        return (
          <Card key={status} className="bg-muted/30 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-md flex items-center justify-center" style={{ backgroundColor: meta.color + "20", color: meta.color }}>
                  <Icon size={14} />
                </div>
                <h3 className="font-semibold text-sm">{meta.label}</h3>
              </div>
              <Badge variant="secondary" className="font-mono">{items.length}</Badge>
            </div>

            <div className="space-y-2 min-h-[100px]">
              {items.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50 italic border border-dashed border-border/40 rounded-lg">
                  Sin pedidos
                </div>
              ) : (
                items.map((r) => (
                  <div key={r.id} className="p-3 bg-card rounded-lg border border-border hover:border-primary/30 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm leading-snug">{r.description}</div>
                      <div className="size-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: PRIORITY_COLOR[r.priority] }} title={r.priority} />
                    </div>
                    {(r.unit || r.guest) && (
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                        {r.unit && <span className="font-mono">{r.unit.code}</span>}
                        {r.guest && <span>· {r.guest.full_name}</span>}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
                      <span>{formatTimeAgo(r.created_at)}</span>
                      {r.cost !== null && r.cost !== undefined && (
                        <span className="font-semibold text-foreground">{formatMoney(r.cost, r.cost_currency ?? "ARS")}</span>
                      )}
                    </div>
                    {r.status !== "completada" && r.status !== "rechazada" && r.status !== "cancelada" && (
                      <Button size="sm" variant="outline" className="w-full mt-2 h-7 text-xs gap-1" onClick={() => advance(r)} disabled={isPending}>
                        Avanzar <ChevronRight size={11} />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
