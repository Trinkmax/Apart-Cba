"use client";

import { useState, useTransition } from "react";
import { Plus, Star, Trash2, Loader2 } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { linkOwnerToUnit, unlinkOwnerFromUnit } from "@/lib/actions/units";
import { getInitials } from "@/lib/format";
import type { UnitOwner, Owner } from "@/lib/types/database";

interface UnitOwnersManagerProps {
  unitId: string;
  unitOwners: (UnitOwner & { owner: Owner })[];
  availableOwners: Owner[];
}

export function UnitOwnersManager({ unitId, unitOwners, availableOwners }: UnitOwnersManagerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedOwner, setSelectedOwner] = useState("");
  const [pct, setPct] = useState(100);
  const [isPrimary, setIsPrimary] = useState(unitOwners.length === 0);
  const [override, setOverride] = useState<string>("");

  const totalPct = unitOwners.reduce((acc, uo) => acc + Number(uo.ownership_pct), 0);
  const linkedIds = new Set(unitOwners.map((uo) => uo.owner_id));
  const selectableOwners = availableOwners.filter((o) => !linkedIds.has(o.id));

  function preserveScrollAcrossRefresh() {
    if (typeof window === "undefined") return;
    const scrollY = window.scrollY;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior }))
    );
  }

  function handleAdd() {
    if (!selectedOwner || pct <= 0) {
      toast.error("Completá los datos");
      return;
    }
    if (totalPct + pct > 100) {
      toast.error("La suma de % de propiedad no puede pasar 100");
      return;
    }
    startTransition(async () => {
      try {
        await linkOwnerToUnit(
          unitId,
          selectedOwner,
          pct,
          isPrimary,
          override === "" ? null : Number(override)
        );
        toast.success("Propietario agregado");
        setOpen(false);
        setSelectedOwner("");
        setPct(100);
        setOverride("");
        router.refresh();
        preserveScrollAcrossRefresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function handleUnlink(unitOwnerId: string) {
    if (!confirm("¿Quitar este propietario de la unidad?")) return;
    startTransition(async () => {
      try {
        await unlinkOwnerFromUnit(unitOwnerId, unitId);
        toast.success("Propietario quitado");
        router.refresh();
        preserveScrollAcrossRefresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold">Propietarios</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Total asignado: {totalPct.toFixed(0)}% / 100%
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={selectableOwners.length === 0}>
              <Plus size={14} /> Agregar
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-w-md"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Agregar propietario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Propietario</Label>
                <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                  <SelectContent>
                    {selectableOwners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>% de propiedad (resta {(100 - totalPct).toFixed(0)}%)</Label>
                <Input
                  type="number"
                  min="0"
                  max={100 - totalPct}
                  value={pct}
                  onChange={(e) => setPct(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Comisión Apart Cba (override, opcional)</Label>
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
                <Label htmlFor="is_primary" className="cursor-pointer">Marcar como propietario principal</Label>
                <Switch id="is_primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleAdd} disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                Agregar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {unitOwners.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Esta unidad no tiene propietarios asignados
        </div>
      ) : (
        <div className="space-y-2">
          {unitOwners.map((uo) => (
            <div key={uo.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                  {getInitials(uo.owner.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{uo.owner.full_name}</span>
                  {uo.is_primary && (
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1 font-normal text-[10px]">
                      <Star size={10} className="fill-current" /> Principal
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {uo.commission_pct_override !== null && uo.commission_pct_override !== undefined
                    ? `Comisión override: ${uo.commission_pct_override}%`
                    : "Comisión por defecto"}
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-sm font-semibold">
                {Number(uo.ownership_pct).toFixed(0)}%
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleUnlink(uo.id)}
                disabled={isPending}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
