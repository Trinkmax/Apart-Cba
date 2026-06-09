"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, Plus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateSettlement } from "@/lib/actions/settlements";
import type { Owner } from "@/lib/types/database";

/**
 * El listado del page (`/dashboard/liquidaciones`) llama `listOwners()` que ya
 * trae cada owner con su array `unit_owners`. Tipamos lo mínimo necesario
 * acá para mostrar "(sin unidades)" en el selector y bloquear el botón
 * Generar antes de pegarle al server.
 */
type OwnerWithUnits = Owner & { unit_owners?: { unit?: unknown }[] | null };

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Autocontenido: renderiza su PROPIO botón disparador (no recibe children
 * desde un Server Component). Mismo patrón que UnitOwnersManager.
 */
export function GenerateSettlementDialog({
  owners,
}: {
  owners: OwnerWithUnits[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const now = new Date();
  const [ownerId, setOwnerId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const selectedOwner = owners.find((o) => o.id === ownerId);
  const selectedOwnerUnitCount = selectedOwner?.unit_owners?.length ?? 0;
  const selectedOwnerHasNoUnits =
    !!selectedOwner && selectedOwnerUnitCount === 0;

  function handleGenerate() {
    if (!ownerId) {
      toast.error("Seleccioná un propietario");
      return;
    }
    if (selectedOwnerHasNoUnits) {
      toast.error("Sin unidades asignadas", {
        description:
          "Asigná al menos una unidad a este propietario antes de generar la liquidación.",
      });
      return;
    }
    startTransition(async () => {
      try {
        const result = await generateSettlement(ownerId, year, month);
        if (!result.ok) {
          toast.error("No se pudo generar la liquidación", {
            description: result.message,
          });
          return;
        }
        toast.success("Liquidación generada", {
          description: `${result.lines.length} líneas · neto: ${result.settlement.net_payable.toFixed(2)} ARS`,
        });
        setOpen(false);
        router.push(`/dashboard/liquidaciones/${result.settlement.id}`);
      } catch (e) {
        // Reservado para errores inesperados (red, DB caída). Los errores de
        // negocio (sin unidades, ya cerrada, etc.) llegan como result.ok=false.
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus size={16} />
          <span className="hidden sm:inline">Generar liquidación</span>
          <span className="sm:hidden">Generar</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Generar liquidación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Propietario</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir..." />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o) => {
                  const count = o.unit_owners?.length ?? 0;
                  return (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="flex items-center gap-2">
                        <span>{o.full_name}</span>
                        {count === 0 && (
                          <span className="text-[10px] text-rose-600 dark:text-rose-400">
                            (sin unidades)
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedOwnerHasNoUnits && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                Este propietario no tiene unidades asignadas. Asigná al menos
                una antes de generar la liquidación.
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Año</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => setYear(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(
                    (y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Mes</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => setMonth(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-[11px] text-muted-foreground">
            <p>
              La liquidación se genera en{" "}
              <span className="font-semibold text-foreground">ARS</span>. Si hay
              reservas o cargos en USD (u otra moneda), se incluyen y podés
              cargar el tipo de cambio del día en el detalle para convertirlos
              al total.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isPending || selectedOwnerHasNoUnits}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            Generar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
