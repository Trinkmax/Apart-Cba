"use client";

import { useState, useTransition } from "react";
import {
  Building2, Clock, Sparkles, CheckCircle2, ChevronDown, ChevronUp, BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { changeCleaningStatus, updateCleaningChecklist } from "@/lib/actions/cleaning";
import { CLEANING_STATUS_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CleaningTask, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };
type ChecklistItem = { item: string; done: boolean; note?: string };

export function MobileCleaningList({ tasks }: { tasks: CT[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(tasks[0]?.id ?? null);

  function start(id: string) {
    startTransition(async () => {
      await changeCleaningStatus(id, "en_progreso");
      toast.success("Iniciaste la tarea");
      router.refresh();
    });
  }
  function complete(id: string) {
    startTransition(async () => {
      await changeCleaningStatus(id, "completada");
      toast.success("Completada — esperando verificación");
      router.refresh();
    });
  }

  function toggleItem(taskId: string, itemIdx: number, current: ChecklistItem[]) {
    const next = [...current];
    next[itemIdx] = { ...next[itemIdx], done: !next[itemIdx].done };
    startTransition(async () => {
      await updateCleaningChecklist(taskId, next);
      router.refresh();
    });
  }

  if (tasks.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Sparkles className="size-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">¡Todo al día!</p>
        <p className="text-xs text-muted-foreground mt-1">Sin tareas asignadas</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((t) => {
        const meta = CLEANING_STATUS_META[t.status];
        const checklist = (t.checklist as ChecklistItem[]) ?? [];
        const done = checklist.filter((i) => i.done).length;
        const total = checklist.length;
        const isOpen = expanded === t.id;

        return (
          <Card key={t.id} className="overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : t.id)}
              className="w-full p-4 text-left hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">{t.unit.code}</span>
                  </div>
                  <div className="font-semibold mt-1">{t.unit.name}</div>
                  <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                    <Clock size={10} />
                    {formatDateTime(t.scheduled_for)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className="font-normal text-[10px] gap-1" style={{ color: meta.color, backgroundColor: meta.color + "15", borderColor: meta.color + "30" }}>
                    {meta.label}
                  </Badge>
                  {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </div>
              </div>

              {total > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] text-muted-foreground mb-1">
                    Checklist {done}/{total}
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                </div>
              )}
            </button>

            {isOpen && (
              <div className="border-t p-4 space-y-3 bg-muted/20 animate-fade-up">
                {checklist.length > 0 && (
                  <div className="space-y-2">
                    {checklist.map((item, idx) => (
                      <label
                        key={idx}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/30 transition-colors",
                          item.done && "opacity-50 line-through"
                        )}
                      >
                        <Checkbox
                          checked={item.done}
                          onCheckedChange={() => toggleItem(t.id, idx, checklist)}
                          disabled={isPending || t.status === "verificada"}
                        />
                        <span className="text-sm flex-1">{item.item}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {t.status === "pendiente" && (
                    <Button onClick={() => start(t.id)} disabled={isPending} className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700">
                      <Sparkles size={14} /> Iniciar
                    </Button>
                  )}
                  {t.status === "en_progreso" && (
                    <Button onClick={() => complete(t.id)} disabled={isPending} className="flex-1 gap-2 bg-cyan-600 hover:bg-cyan-700">
                      <CheckCircle2 size={14} /> Marcar completada
                    </Button>
                  )}
                  {t.status === "completada" && (
                    <div className="flex-1 text-center text-xs text-muted-foreground py-2">
                      <BadgeCheck className="inline size-4 text-cyan-500 mr-1" />
                      Esperando verificación
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
