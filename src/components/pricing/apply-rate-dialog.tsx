"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPricingRule } from "@/lib/actions/listings";

interface Props {
  unitId: string;
  dateFrom: string;
  dateTo: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ApplyRateDialog({ unitId, dateFrom, dateTo, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"override" | "multiplier">("override");
  const [priceOverride, setPriceOverride] = useState("");
  const [multiplier, setMultiplier] = useState("1.0");
  const [minNights, setMinNights] = useState("");
  const [priority, setPriority] = useState("10");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      try {
        const r = await createPricingRule({
          unit_id: unitId,
          name: name || `Tarifa ${dateFrom} a ${dateTo}`,
          rule_type: "date_range",
          start_date: dateFrom,
          end_date: dateTo,
          days_of_week: null,
          price_override: mode === "override" ? Number(priceOverride) : null,
          price_multiplier: mode === "multiplier" ? Number(multiplier) : null,
          min_nights_override: minNights ? Number(minNights) : null,
          priority: Number(priority),
        });
        if (!r.ok) {
          toast.error("Error", { description: r.error });
          return;
        }
        toast.success("Regla de tarifa creada");
        onSaved();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aplicar tarifa — {dateFrom} a {dateTo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nombre de la regla</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Tarifa ${dateFrom} a ${dateTo}`}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de precio</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "override" ? "default" : "outline"}
                onClick={() => setMode("override")}
              >
                Precio fijo
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "multiplier" ? "default" : "outline"}
                onClick={() => setMode("multiplier")}
              >
                Multiplicador
              </Button>
            </div>
          </div>

          {mode === "override" ? (
            <div className="space-y-2">
              <Label>Precio por noche</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={priceOverride}
                onChange={(e) => setPriceOverride(e.target.value)}
                placeholder="Ej: 25000"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Multiplicador sobre precio base</Label>
              <Input
                type="number"
                min={0.1}
                max={10}
                step={0.05}
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                placeholder="Ej: 1.5"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Noches mínimas</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={minNights}
                onChange={(e) => setMinNights(e.target.value)}
                placeholder="Sin cambio"
              />
            </div>
            <div className="space-y-2">
              <Label>Prioridad (0-100)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="animate-spin size-4 mr-2" />}
            Crear regla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
