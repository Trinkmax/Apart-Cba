"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addSettlementBookingRow } from "@/lib/actions/settlements";

type Unit = { id: string; code: string; name: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Carga una reserva a mano en el detalle de la liquidación. Suma al neto del
 * documento; no crea una reserva real (calendario) ni mueve Caja.
 */
export function AddBookingRowDialog({
  open,
  onOpenChange,
  settlementId,
  currency,
  units,
  currentNet,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settlementId: string;
  currency: string;
  units: Unit[];
  currentNet: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [unitId, setUnitId] = useState("");
  const [guest, setGuest] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [nights, setNights] = useState("");
  const [gross, setGross] = useState("");
  const [pct, setPct] = useState("20");
  const [commission, setCommission] = useState("");
  const [expenses, setExpenses] = useState("");

  const rowNet = round2(num(gross) - num(commission) - num(expenses));
  const projected = round2(currentNet + rowNet);

  function onGross(v: string) {
    setGross(v);
    setCommission(String(round2((num(v) * num(pct)) / 100)));
  }
  function onPct(v: string) {
    setPct(v);
    setCommission(String(round2((num(gross) * num(v)) / 100)));
  }
  function onCommission(v: string) {
    setCommission(v);
    const g = num(gross);
    setPct(g > 0 ? String(round2((num(v) / g) * 100)) : "0");
  }

  function close() {
    setUnitId("");
    setGuest("");
    setCheckIn("");
    setCheckOut("");
    setNights("");
    setGross("");
    setPct("20");
    setCommission("");
    setExpenses("");
    onOpenChange(false);
  }

  function save() {
    if (!unitId) {
      toast.error("Elegí una unidad");
      return;
    }
    if (num(gross) < 0) {
      toast.error("El bruto no puede ser negativo");
      return;
    }
    start(async () => {
      try {
        await addSettlementBookingRow({
          settlement_id: settlementId,
          unit_id: unitId,
          guest_name: guest.trim() || null,
          check_in: checkIn || null,
          check_out: checkOut || null,
          nights: Math.max(0, Math.round(num(nights))),
          gross: round2(num(gross)),
          commission: round2(num(commission)),
          expenses: round2(num(expenses)),
        });
        toast.success("Reserva agregada");
        close();
        router.refresh();
      } catch (e) {
        toast.error("No se pudo agregar", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar reserva</DialogTitle>
          <DialogDescription>
            Carga una reserva a mano. Suma al neto de la liquidación; no crea
            una reserva en el calendario ni movimientos en Caja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegí una unidad" />
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
              <Label>Huésped</Label>
              <Input value={guest} onChange={(e) => setGuest(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Ingreso</Label>
              <Input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Egreso</Label>
              <Input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Noches</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={nights}
                onChange={(e) => setNights(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Bruto</Label>
              <Input
                type="number"
                step="0.01"
                value={gross}
                onChange={(e) => onGross(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>% comisión</Label>
              <Input
                type="number"
                step="0.01"
                value={pct}
                onChange={(e) => onPct(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Comisión</Label>
              <Input
                type="number"
                step="0.01"
                value={commission}
                onChange={(e) => onCommission(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Gastos (limpieza / expensas)</Label>
            <Input
              type="number"
              step="0.01"
              value={expenses}
              onChange={(e) => setExpenses(e.target.value)}
            />
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Neto de esta reserva
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(rowNet, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Neto liquidación</span>
              <span className="tabular-nums flex items-center gap-1.5">
                <span className="text-muted-foreground">
                  {formatMoney(currentNet, currency)}
                </span>
                <ArrowRight size={11} className="text-muted-foreground" />
                <span
                  className={cn(
                    "font-medium",
                    rowNet > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : rowNet < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "",
                  )}
                >
                  {formatMoney(projected, currency)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending} className="gap-2">
            {pending && <Loader2 size={14} className="animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
