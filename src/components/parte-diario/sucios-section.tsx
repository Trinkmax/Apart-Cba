"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Wand2, UserPlus, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLEANING_STATUS_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionShell } from "./section-shell";
import {
  assignCleaningInDraft,
  autoAssignCleanings,
  createMissingCleaningTasksForDate,
} from "@/lib/actions/parte-diario";
import { createCleaningTask } from "@/lib/actions/cleaning";
import type {
  ParteDiarioCleaningRow,
  ParteDiarioCleanerLoad,
} from "@/lib/types/database";

interface SuciosSectionProps {
  date: string;
  rows: ParteDiarioCleaningRow[];
  cleaners: ParteDiarioCleanerLoad[];
  canEdit: boolean;
}

export function SuciosSection({ date, rows, cleaners, canEdit }: SuciosSectionProps) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(rows);

  // Si el server-side change pisa nuestra optimistic state, sync.
  if (rows !== optimistic && rows.length !== optimistic.length) {
    // re-sync cuando cambia el set de rows desde el server (revalidate)
    setOptimistic(rows);
  }

  const handleAssign = (taskId: string, userId: string | null) => {
    setOptimistic((prev) =>
      prev.map((r) =>
        r.task_id === taskId
          ? {
              ...r,
              assigned_to: userId,
              assigned_to_name: userId
                ? cleaners.find((c) => c.user_id === userId)?.full_name ?? null
                : null,
            }
          : r,
      ),
    );
    startTransition(async () => {
      try {
        await assignCleaningInDraft(taskId, userId);
      } catch (err) {
        toast.error("No se pudo asignar", { description: (err as Error).message });
        setOptimistic(rows); // rollback
      }
    });
  };

  const handleAutoAssign = () => {
    startTransition(async () => {
      try {
        const res = await autoAssignCleanings(date);
        if (res.assigned > 0) {
          toast.success(`Asignadas ${res.assigned} limpieza${res.assigned > 1 ? "s" : ""}`, {
            description: "Carga balanceada entre el equipo.",
          });
        } else {
          toast.message("Todo asignado", {
            description: "No quedaba nada por repartir.",
          });
        }
      } catch (err) {
        toast.error("No se pudo auto-asignar", { description: (err as Error).message });
      }
    });
  };

  const handleCreateMissing = () => {
    startTransition(async () => {
      try {
        const res = await createMissingCleaningTasksForDate(date);
        if (res.created > 0) {
          toast.success(`Creadas ${res.created} tarea${res.created > 1 ? "s" : ""}`, {
            description: "Limpiezas pendientes de los check-outs.",
          });
        } else {
          toast.message("Sin tareas faltantes");
        }
      } catch (err) {
        toast.error("No se pudo crear", { description: (err as Error).message });
      }
    });
  };

  const handleCreateForGhost = (row: ParteDiarioCleaningRow) => {
    startTransition(async () => {
      try {
        await createCleaningTask({
          unit_id: row.unit_id,
          scheduled_for: date,
          assigned_to: null,
          status: "pendiente",
          checklist: [],
          cost: null,
          cost_currency: "ARS",
          notes: null,
        });
        toast.success("Tarea creada");
      } catch (err) {
        toast.error("No se pudo crear", { description: (err as Error).message });
      }
    });
  };

  const ghostCount = optimistic.filter((r) => r.task_id === null).length;
  const unassignedCount = optimistic.filter((r) => r.task_id && !r.assigned_to).length;

  return (
    <SectionShell
      sectionKey="sucios"
      count={optimistic.length}
      isEmpty={optimistic.length === 0}
      emptyMessage="Sin unidades a limpiar."
      actions={
        canEdit ? (
          <>
            {ghostCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateMissing}
                disabled={pending}
                className="h-8 gap-1.5"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Crear {ghostCount} faltante{ghostCount > 1 ? "s" : ""}
              </Button>
            ) : null}
            {unassignedCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoAssign}
                disabled={pending}
                className="h-8 gap-1.5"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                Auto-asignar
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <ul className="divide-y">
        {optimistic.map((row) => (
          <li
            key={row.task_id ?? `ghost-${row.unit_id}`}
            className={cn(
              "flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors",
              row.task_id === null && "bg-amber-500/5",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {row.unit_code}
                </span>
                <span className="text-sm text-muted-foreground truncate">{row.unit_name}</span>
                {row.task_id === null ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
                    <AlertCircle className="size-3" />
                    sin tarea
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {row.guest_name
                  ? `Sale ${row.guest_name}${row.check_out_time ? ` · ${row.check_out_time.slice(0, 5)}` : ""}`
                  : row.check_out_time
                    ? `Check-out ${row.check_out_time.slice(0, 5)}`
                    : row.status
                      ? CLEANING_STATUS_META[row.status].label
                      : "Pendiente de creación"}
              </p>
            </div>
            {row.task_id === null ? (
              canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCreateForGhost(row)}
                  disabled={pending}
                  className="h-8 gap-1.5 shrink-0"
                >
                  <Plus className="size-3.5" />
                  Crear tarea
                </Button>
              ) : null
            ) : canEdit ? (
              <Select
                value={row.assigned_to ?? "__none__"}
                onValueChange={(v) =>
                  handleAssign(row.task_id as string, v === "__none__" ? null : v)
                }
                disabled={pending}
              >
                <SelectTrigger className="h-8 w-[180px] shrink-0 text-xs" aria-label="Asignar a">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="__none__">
                    <span className="flex items-center gap-2">
                      <UserPlus className="size-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground italic">Sin asignar</span>
                    </span>
                  </SelectItem>
                  {cleaners.map((c) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      <span className="flex items-center justify-between gap-3 w-full">
                        <span>{c.full_name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {c.count}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground italic shrink-0">
                {row.assigned_to_name ?? "Sin asignar"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
