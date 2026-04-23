"use client";

import { useMemo, useTransition } from "react";
import { Clock, Sparkles, CheckCircle2, BadgeCheck, Building2, ChevronRight, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLEANING_STATUS_META } from "@/lib/constants";
import { formatDateTime, formatTimeAgo } from "@/lib/format";
import { changeCleaningStatus } from "@/lib/actions/cleaning";
import { cn } from "@/lib/utils";
import type { CleaningTask, Unit, CleaningStatus } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

const COLUMNS: { key: CleaningStatus; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: "pendiente", icon: Clock },
  { key: "en_progreso", icon: Sparkles },
  { key: "completada", icon: CheckCircle2 },
  { key: "verificada", icon: BadgeCheck },
];

export function CleaningBoard({ tasks }: { tasks: CT[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<CleaningStatus, CT[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    tasks.forEach((t) => map.get(t.status as CleaningStatus)?.push(t));
    return map;
  }, [tasks]);

  function advance(t: CT) {
    const next: Record<CleaningStatus, CleaningStatus | null> = {
      pendiente: "en_progreso",
      en_progreso: "completada",
      completada: "verificada",
      verificada: null,
      cancelada: null,
    };
    const newStatus = next[t.status as CleaningStatus];
    if (!newStatus) return;
    startTransition(async () => {
      try {
        await changeCleaningStatus(t.id, newStatus);
        toast.success(`→ ${CLEANING_STATUS_META[newStatus].label}`);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {COLUMNS.map((col) => {
        const items = grouped.get(col.key) ?? [];
        const meta = CLEANING_STATUS_META[col.key];
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
                  Sin tareas
                </div>
              ) : (
                items.map((t) => {
                  const checklist = (t.checklist as { item: string; done: boolean }[]) ?? [];
                  const done = checklist.filter((i) => i.done).length;
                  const total = checklist.length;
                  return (
                    <div key={t.id} className="p-3 bg-card rounded-lg border border-border hover:border-primary/30 hover:shadow-sm transition-all">
                      <div className="flex items-center gap-2">
                        <Building2 size={12} className="text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground">{t.unit.code}</span>
                        <span className="text-xs truncate">· {t.unit.name}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                        <Calendar size={10} />
                        {formatDateTime(t.scheduled_for)}
                      </div>
                      {total > 0 && (
                        <div className="mt-2">
                          <div className="text-[10px] text-muted-foreground mb-1">
                            Checklist {done}/{total}
                          </div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${(done / total) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {t.status !== "verificada" && t.status !== "cancelada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-3 gap-1 h-7 text-xs"
                          onClick={() => advance(t)}
                          disabled={isPending}
                        >
                          Avanzar
                          <ChevronRight size={12} />
                        </Button>
                      )}
                    </div>
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
