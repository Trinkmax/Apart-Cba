"use client";

import { useEffect, useState, useTransition } from "react";
import {
  BadgeCheck,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CLEANING_STATUS_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import {
  changeCleaningStatus,
  deleteCleaningTask,
  updateCleaningChecklist,
  updateCleaningTask,
} from "@/lib/actions/cleaning";
import { cn } from "@/lib/utils";
import type { CleaningStatus, CleaningTask, Unit } from "@/lib/types/database";

type CT = CleaningTask & { unit: Pick<Unit, "id" | "code" | "name"> };
type ChecklistItem = { item: string; done: boolean; note?: string };

const STATUS_ICON: Record<CleaningStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  pendiente: Clock,
  en_progreso: Sparkles,
  completada: CheckCircle2,
  verificada: BadgeCheck,
  cancelada: Clock,
};

interface Props {
  task: CT | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (task: CT) => void;
  onDeleted?: (id: string) => void;
}

export function CleaningDetailDialog({ task, open, onOpenChange, onUpdated, onDeleted }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState<string>("");

  useEffect(() => {
    if (task) {
      const cl = (task.checklist as ChecklistItem[]) ?? [];
      setChecklist(cl);
      setNotes(task.notes ?? "");
      setCost(task.cost?.toString() ?? "");
      setConfirmDelete(false);
    }
  }, [task]);

  if (!task) return null;

  const meta = CLEANING_STATUS_META[task.status as CleaningStatus];
  const Icon = STATUS_ICON[task.status as CleaningStatus];
  const done = checklist.filter((c) => c.done).length;
  const total = checklist.length;
  const pct = total > 0 ? (done / total) * 100 : 0;

  function changeStatus(s: CleaningStatus) {
    startTransition(async () => {
      try {
        await changeCleaningStatus(task!.id, s);
        onUpdated?.({ ...task!, status: s });
        toast.success("Estado actualizado");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function toggleItem(idx: number) {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    setChecklist(next);
    startTransition(async () => {
      try {
        await updateCleaningChecklist(task!.id, next);
      } catch (e) {
        setChecklist(checklist);
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function saveDetails() {
    startTransition(async () => {
      try {
        const updated = await updateCleaningTask(task!.id, {
          notes,
          cost: cost === "" ? null : Number(cost),
        });
        onUpdated?.({ ...task!, notes: updated.notes, cost: updated.cost });
        toast.success("Cambios guardados");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteCleaningTask(task!.id);
        onDeleted?.(task!.id);
        toast.success("Tarea eliminada");
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="h-1.5 w-full" style={{ backgroundColor: meta.color }} aria-hidden />
        <DialogHeader className="px-6 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <span
              className="size-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: meta.color + "1a", color: meta.color }}
            >
              <Icon size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg leading-tight flex items-center gap-2">
                <Building2 size={16} className="text-muted-foreground" />
                <span className="font-mono">{task.unit.code}</span>
                <span className="text-muted-foreground font-normal">·</span>
                <span className="truncate">{task.unit.name}</span>
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge
                  variant="outline"
                  className="font-mono gap-1.5"
                  style={{ borderColor: meta.color + "40", color: meta.color }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                  {meta.label}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar size={12} /> {formatDateTime(task.scheduled_for)}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <div className="px-6 py-5 space-y-5">
          {/* Status pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Mover a:</span>
            {(Object.keys(CLEANING_STATUS_META) as CleaningStatus[]).map((s) => {
              const m = CLEANING_STATUS_META[s];
              const isCur = task.status === s;
              return (
                <button
                  key={s}
                  disabled={isCur || isPending}
                  onClick={() => changeStatus(s)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                    isCur ? "opacity-50 cursor-default" : "hover:scale-[1.03] active:scale-95"
                  )}
                  style={{
                    backgroundColor: isCur ? m.color + "20" : m.color + "0d",
                    color: m.color,
                    borderColor: m.color + (isCur ? "60" : "30"),
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Checklist */}
          {total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Checklist
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {done}/{total}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: meta.color }}
                />
              </div>
              <ul className="space-y-1 mt-2">
                {checklist.map((c, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => toggleItem(idx)}
                      disabled={isPending}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors",
                        c.done ? "bg-emerald-500/5" : "hover:bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          c.done
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-input"
                        )}
                      >
                        {c.done && <CheckCircle2 size={11} />}
                      </span>
                      <span className={cn(c.done && "line-through text-muted-foreground")}>
                        {c.item}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes & cost */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Costo
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                onBlur={saveDetails}
                placeholder="—"
              />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Notas
              </Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveDetails}
              />
            </div>
          </div>
        </div>

        <Separator />

        <DialogFooter className="px-6 py-4 sm:justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive font-medium">¿Eliminar tarea?</span>
              <Button size="sm" variant="destructive" disabled={isPending} onClick={handleDelete}>
                {isPending && <Loader2 className="animate-spin" size={14} />}
                Sí
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                No
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} /> Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
