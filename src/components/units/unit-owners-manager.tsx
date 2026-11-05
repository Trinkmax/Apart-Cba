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
import {
  formatCommissionPct,
  ownerCommissionWarning,
  parseOwnerCommission,
} from "@/lib/finance/commission-summary";
import type { UnitOwner, Owner } from "@/lib/types/database";

interface UnitOwnersManagerProps {
  unitId: string;
  unitOwners: (UnitOwner & { owner: Owner })[];
  availableOwners: Owner[];
  /** La que rige si el propietario no tiene acuerdo propio (`commissionSummary`). */
  normalCommissionLabel: string;
  /**
   * Agregar, quitar y editar el acuerdo de comisión (units:update). Sin el permiso
   * el servidor lo rechaza, así que la lista queda de sólo lectura.
   */
  canEdit?: boolean;
}

export function UnitOwnersManager({
  unitId,
  unitOwners,
  availableOwners,
  normalCommissionLabel,
  canEdit = false,
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

  const comisionDe = (override: number | null | undefined) =>
    override !== null && override !== undefined
      ? `Comisión de administración: ${formatCommissionPct(Number(override))} (acordada con este propietario, manda sobre las demás)`
      : `Comisión de administración: ${normalCommissionLabel}`;

  const addOverrideParsed = parseOwnerCommission(override);
  const addWarning = addOverrideParsed.ok ? ownerCommissionWarning(addOverrideParsed.value) : null;
  const editParsed = parseOwnerCommission(editingValue);
  const editWarning = editParsed.ok ? ownerCommissionWarning(editParsed.value) : null;

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
    if (!addOverrideParsed.ok) {
      toast.error("Comisión inválida", { description: "Tiene que ser un número entre 0 y 100." });
      return;
    }
    if (addWarning && !window.confirm(`${addWarning}\n\n¿Guardar igual?`)) return;
    const commission = addOverrideParsed.value;
    startTransition(async () => {
      try {
        await linkOwnerToUnit(unitId, selectedOwner, pct, isPrimary, commission);
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
    if (!editParsed.ok) {
      toast.error("Comisión inválida", { description: "Tiene que ser un número entre 0 y 100." });
      return;
    }
    if (editWarning && !window.confirm(`${editWarning}\n\n¿Guardar igual?`)) return;
    const commission = editParsed.value;
    startTransition(async () => {
      try {
        await updateUnitOwnerCommission(editing.id, unitId, commission);
        toast.success(
          commission === null
            ? "Ahora usa la comisión normal"
            : `Comisión de administración: ${formatCommissionPct(commission)}`
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
            Total asignado: {totalPct.toFixed(0)}% / 100% · Comisión normal:{" "}
            {normalCommissionLabel}
          </p>
        </div>
        {canEdit && (
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
                    placeholder="Vacío = la comisión normal"
                  />
                  {addWarning ? (
                    <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300" role="alert">
                      {addWarning}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Solo si con este propietario arreglaste un porcentaje distinto: manda
                      sobre cualquier otra comisión. Vacío rige la normal:{" "}
                      {normalCommissionLabel}.
                    </p>
                  )}
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
        )}
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
                {canEdit ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 hover:text-foreground transition-colors text-left"
                    onClick={() => openEditor(uo.id, uo.owner.full_name, uo.commission_pct_override)}
                    disabled={isPending}
                  >
                    {comisionDe(uo.commission_pct_override)}
                    <Pencil size={11} className="opacity-60 shrink-0" />
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {comisionDe(uo.commission_pct_override)}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="font-mono text-sm font-semibold">
                {Number(uo.ownership_pct).toFixed(0)}%
              </Badge>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleUnlink(uo.id)}
                  disabled={isPending}
                  aria-label={`Quitar a ${uo.owner.full_name}`}
                >
                  <Trash2 size={14} />
                </Button>
              )}
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
                placeholder="Vacío = la comisión normal"
                autoFocus
              />
              {editWarning ? (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300" role="alert">
                  {editWarning}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Dejalo vacío para usar la comisión normal: {normalCommissionLabel}.
                </p>
              )}
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
