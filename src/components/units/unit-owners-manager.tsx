"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Star, Trash2, Loader2 } from "lucide-react";
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
import {
  linkOwnerToUnit,
  unlinkOwnerFromUnit,
  updateUnitOwnerCommission,
} from "@/lib/actions/units";
import { getInitials } from "@/lib/format";
import type { UnitOwner, Owner } from "@/lib/types/database";

interface UnitOwnersManagerProps {
  unitId: string;
  unitOwners: (UnitOwner & { owner: Owner })[];
  availableOwners: Owner[];
  /** La comisión de la unidad: es la que rige si el propietario no tiene excepción. */
  unitDefaultCommissionPct: number | null;
}

/** `null` = sin excepción, se usa la comisión de la unidad. */
function parseOverride(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false };
  return { ok: true, value: n };
}

export function UnitOwnersManager({
  unitId,
  unitOwners,
  availableOwners,
  unitDefaultCommissionPct,
}: UnitOwnersManagerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedOwner, setSelectedOwner] = useState("");
  const [pct, setPct] = useState(100);
  const [isPrimary, setIsPrimary] = useState(unitOwners.length === 0);
  const [override, setOverride] = useState<string>("");
  /** Fila cuya excepción de comisión se está editando (null = dialog cerrado). */
  const [editing, setEditing] = useState<{ id: string; ownerName: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

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
    const parsedOverride = parseOverride(override);
    if (!parsedOverride.ok) {
      toast.error("Comisión inválida", { description: "Tiene que ser un número entre 0 y 100." });
      return;
    }
    startTransition(async () => {
      try {
        await linkOwnerToUnit(unitId, selectedOwner, pct, isPrimary, parsedOverride.value);
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

  function openEditor(unitOwnerId: string, ownerName: string, current: number | null | undefined) {
    setEditing({ id: unitOwnerId, ownerName });
    setEditingValue(current === null || current === undefined ? "" : String(current));
  }

  function handleSaveOverride() {
    if (!editing) return;
    const parsed = parseOverride(editingValue);
    if (!parsed.ok) {
      toast.error("Comisión inválida", { description: "Tiene que ser un número entre 0 y 100." });
      return;
    }
    startTransition(async () => {
      try {
        await updateUnitOwnerCommission(editing.id, unitId, parsed.value);
        toast.success(
          parsed.value === null
            ? "Ahora usa la comisión de la unidad"
            : `Comisión de administración: ${parsed.value}%`
        );
        setEditing(null);
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
            Total asignado: {totalPct.toFixed(0)}% / 100% · Comisión de administración
            de la unidad: {unitDefaultCommissionPct ?? 20}%
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
                <Label>Comisión de administración (solo para este propietario)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder={`Vacío = ${unitDefaultCommissionPct ?? 20}% (la de la unidad)`}
                />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Solo si con este propietario arreglaste un porcentaje distinto. Lo
                  podés cambiar cuando quieras.
                </p>
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
                <button
                  type="button"
                  className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 hover:text-foreground transition-colors text-left"
                  onClick={() => openEditor(uo.id, uo.owner.full_name, uo.commission_pct_override)}
                  disabled={isPending}
                >
                  {uo.commission_pct_override !== null && uo.commission_pct_override !== undefined
                    ? `Comisión de administración: ${uo.commission_pct_override}% (solo para este propietario)`
                    : `Comisión de administración: ${unitDefaultCommissionPct ?? 20}% (la de la unidad)`}
                  <Pencil size={11} className="opacity-60 shrink-0" />
                </button>
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

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Comisión de administración</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Qué porcentaje le descontás a <strong>{editing?.ownerName}</strong> en
              esta unidad cuando generás la liquidación.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="owner-commission">Porcentaje (%)</Label>
              <Input
                id="owner-commission"
                type="text"
                inputMode="decimal"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                placeholder={`${unitDefaultCommissionPct ?? 20}`}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                Dejalo vacío para usar la comisión de la unidad ({unitDefaultCommissionPct ?? 20}%).
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveOverride} disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
