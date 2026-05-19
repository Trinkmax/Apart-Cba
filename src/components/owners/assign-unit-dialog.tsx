"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkUnitToOwner } from "@/lib/actions/owners";

/**
 * Autocontenido (mismo patrón que UnitOwnersManager): renderiza su propio
 * botón. Asigna una unidad disponible a este propietario.
 */
export function AssignUnitDialog({
  ownerId,
  units,
}: {
  ownerId: string;
  units: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [unitId, setUnitId] = useState("");
  const [pct, setPct] = useState(100);
  const [override, setOverride] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  function handleAdd() {
    if (!unitId || pct <= 0) {
      toast.error("Elegí una unidad y un % válido");
      return;
    }
    startTransition(async () => {
      try {
        await linkUnitToOwner(
          ownerId,
          unitId,
          pct,
          isPrimary,
          override === "" ? null : Number(override),
        );
        toast.success("Unidad asignada");
        setOpen(false);
        setUnitId("");
        setPct(100);
        setOverride("");
        setIsPrimary(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={units.length === 0}
        >
          <Plus size={14} /> Asignar unidad
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Asignar unidad</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar…" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code} · {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>% de propiedad</Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Comisión rentOS (override, opcional)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder="Usa la default de la unidad"
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <Label htmlFor="assign_is_primary" className="cursor-pointer">
              Marcar como propietario principal de la unidad
            </Label>
            <Switch
              id="assign_is_primary"
              checked={isPrimary}
              onCheckedChange={setIsPrimary}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleAdd} disabled={isPending} className="gap-2">
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Asignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
