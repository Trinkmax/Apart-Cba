"use client";

import { useState } from "react";
import { BadgeCheck, Building2, Calendar, CheckCircle2, Clock, Plus, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLEANING_STATUS_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { changeCleaningStatus } from "@/lib/actions/cleaning";
import { cn } from "@/lib/utils";
import type { CleaningStatus, CleaningTask, Unit } from "@/lib/types/database";
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board";
import { CleaningDetailDialog } from "./cleaning-detail-dialog";
import { CleaningFormDialog } from "./cleaning-form-dialog";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };

const COLUMNS: KanbanColumn<CleaningStatus>[] = [
  { key: "pendiente", label: CLEANING_STATUS_META.pendiente.label, color: CLEANING_STATUS_META.pendiente.color, icon: Clock, emptyText: "Sin tareas pendientes" },
  { key: "en_progreso", label: CLEANING_STATUS_META.en_progreso.label, color: CLEANING_STATUS_META.en_progreso.color, icon: Sparkles, emptyText: "Soltá tareas aquí" },
  { key: "completada", label: CLEANING_STATUS_META.completada.label, color: CLEANING_STATUS_META.completada.color, icon: CheckCircle2, emptyText: "Soltá tareas aquí" },
  { key: "verificada", label: CLEANING_STATUS_META.verificada.label, color: CLEANING_STATUS_META.verificada.color, icon: BadgeCheck, emptyText: "Soltá tareas aquí" },
  { key: "cancelada", label: CLEANING_STATUS_META.cancelada.label, color: CLEANING_STATUS_META.cancelada.color, icon: X, emptyText: "Canceladas" },
];

interface Props {
  initialTasks: CT[];
  units: Pick<Unit, "id" | "code" | "name">[];
}

export function CleaningBoard({ initialTasks, units }: Props) {
  const [tasks, setTasks] = useState<CT[]>(initialTasks);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? tasks.find((t) => t.id === openId) ?? null : null;

  return (
    <>
      <KanbanBoard<CT, CleaningStatus>
        columns={COLUMNS}
        items={tasks}
        getStatus={(t) => t.status as CleaningStatus}
        setItemStatus={(t, s) => ({ ...t, status: s })}
        onMove={async (id, status) => {
          await changeCleaningStatus(id, status);
          setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, status } : t)));
        }}
        onCardClick={(t) => setOpenId(t.id)}
        renderCard={(t, { dragging }) => <CleaningCard task={t} dragging={dragging} />}
        sortFn={(a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()}
        xlCols={5}
      />

      <CleaningDetailDialog
        task={open}
        open={!!open}
        onOpenChange={(o) => !o && setOpenId(null)}
        onUpdated={(updated) =>
          setTasks((cur) =>
            cur.map((t) => (t.id === updated.id ? { ...t, ...updated, unit: t.unit } : t))
          )
        }
        onDeleted={(id) => {
          setTasks((cur) => cur.filter((t) => t.id !== id));
          setOpenId(null);
        }}
      />

      {/* FAB siempre visible — vía garantizada para crear tickets de limpieza */}
      <CleaningFormDialog units={units}>
        <Button
          size="lg"
          className="fixed bottom-6 right-6 z-40 h-14 rounded-full shadow-lg hover:shadow-xl gap-2 px-5"
        >
          <Plus size={18} /> Nuevo ticket
        </Button>
      </CleaningFormDialog>
    </>
  );
}

function CleaningCard({ task, dragging }: { task: CT; dragging: boolean }) {
  const meta = CLEANING_STATUS_META[task.status as CleaningStatus];
  const cl = (task.checklist as { item: string; done: boolean }[]) ?? [];
  const done = cl.filter((c) => c.done).length;
  const total = cl.length;

  return (
    <div
      className={cn(
        "relative bg-card rounded-lg border shadow-sm overflow-hidden transition-all",
        dragging
          ? "shadow-2xl rotate-1 scale-[1.02] border-primary/40"
          : "border-border hover:border-primary/40 hover:shadow-md"
      )}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: meta.color }}
        aria-hidden
      />
      <div className="p-3 pl-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Building2 size={11} />
          <span className="font-mono font-medium text-foreground">{task.unit.code}</span>
          <span className="truncate">· {task.unit.name}</span>
        </div>
        <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
          <Calendar size={10} />
          {formatDateTime(task.scheduled_for)}
        </div>
        {total > 0 && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Checklist</span>
              <span className="tabular-nums">{done}/{total}</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${(done / total) * 100}%`, backgroundColor: meta.color }}
              />
            </div>
          </div>
        )}
        {task.cost !== null && task.cost !== undefined && (
          <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-end">
            <Badge variant="outline" className="text-[10px] tabular-nums">
              ${Number(task.cost).toLocaleString("es-AR")}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
