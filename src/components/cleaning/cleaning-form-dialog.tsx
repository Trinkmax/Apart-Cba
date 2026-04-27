"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCleaningTask, type CleaningInput } from "@/lib/actions/cleaning";
import { CLEANING_STATUS_META } from "@/lib/constants";
import type { Unit } from "@/lib/types/database";

function defaultScheduledFor(): string {
  // 14:00 today (local) en formato datetime-local
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export function CleaningFormDialog({
  children,
  units,
}: {
  children: React.ReactNode;
  units: Pick<Unit, "id" | "code" | "name">[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const initial: CleaningInput = {
    unit_id: "",
    scheduled_for: defaultScheduledFor(),
    assigned_to: null,
    status: "pendiente",
    checklist: [],
    cost: null,
    cost_currency: "ARS",
    notes: "",
  };
  const [form, setForm] = useState<CleaningInput>(initial);

  function set<K extends keyof CleaningInput>(k: K, v: CleaningInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createCleaningTask({
          ...form,
          scheduled_for: new Date(form.scheduled_for).toISOString(),
        });
        toast.success("Tarea de limpieza creada");
        setForm(initial);
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva tarea de limpieza</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Unidad *</Label>
            <Select value={form.unit_id} onValueChange={(v) => set("unit_id", v)} required>
              <SelectTrigger>
                <SelectValue placeholder="Elegir..." />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="font-mono text-xs mr-2">{u.code}</span>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Programada para *</Label>
            <Input
              type="datetime-local"
              required
              value={form.scheduled_for}
              onChange={(e) => set("scheduled_for", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as CleaningInput["status"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLEANING_STATUS_META).map(([k, m]) => (
                    <SelectItem key={k} value={k}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Costo</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.cost ?? ""}
                onChange={(e) =>
                  set("cost", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="—"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Acceso, prioridades, observaciones..."
            />
          </div>

          <p className="text-xs text-muted-foreground">
            La tarea se crea con el checklist estándar de 9 puntos. Podés ajustarlo después.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !form.unit_id}>
              {isPending && <Loader2 className="animate-spin" size={14} />}
              Crear tarea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
