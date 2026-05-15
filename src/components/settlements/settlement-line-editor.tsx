"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addSettlementLine,
  updateSettlementLine,
  deleteSettlementLine,
} from "@/lib/actions/settlements";
import { SETTLEMENT_LINE_META } from "@/lib/settlements/labels";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettlementLine } from "@/lib/types/database";

type LineType = SettlementLine["line_type"];

export type EditorLine = {
  id: string;
  line_type: LineType;
  description: string;
  unit_id: string | null;
  unitCode: string | null;
  amount: number;
  sign: "+" | "-";
  is_manual: boolean;
};

const TYPE_OPTIONS: { value: LineType; label: string }[] = [
  { value: "adjustment", label: "Ajuste" },
  { value: "booking_revenue", label: "Reserva" },
  { value: "commission", label: "Comisión" },
  { value: "cleaning_charge", label: "Limpieza" },
  { value: "maintenance_charge", label: "Mantenimiento" },
  { value: "expenses_fraction", label: "Expensas" },
  { value: "monthly_rent_fraction", label: "Renta mensual" },
];

function LineForm({
  initial,
  units,
  onSubmit,
  pending,
}: {
  initial?: Partial<EditorLine>;
  units: { id: string; code: string; name: string }[];
  onSubmit: (v: {
    line_type: LineType;
    description: string;
    amount: number;
    sign: "+" | "-";
    unit_id: string | null;
  }) => void;
  pending: boolean;
}) {
  const [lineType, setLineType] = useState<LineType>(
    initial?.line_type ?? "adjustment",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(
    initial?.amount != null ? String(initial.amount) : "",
  );
  const [sign, setSign] = useState<"+" | "-">(initial?.sign ?? "-");
  const [unitId, setUnitId] = useState<string>(initial?.unit_id ?? "none");

  return (
    <div className="space-y-4 mt-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select
            value={lineType}
            onValueChange={(v) => setLineType(v as LineType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Signo</Label>
          <Select
            value={sign}
            onValueChange={(v) => setSign(v as "+" | "-")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="+">+ Suma al neto</SelectItem>
              <SelectItem value="-">− Resta del neto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Descripción</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej: Reintegro por daño, bonificación..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Importe</Label>
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Unidad (opcional)</Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Sin unidad</SelectItem>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.code} · {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() =>
            onSubmit({
              line_type: lineType,
              description: description.trim(),
              amount: Number(amount),
              sign,
              unit_id: unitId === "none" ? null : unitId,
            })
          }
          disabled={pending}
          className="gap-2"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Editor de líneas — solo visible cuando la liquidación está en borrador. */
export function SettlementLineEditor({
  settlementId,
  currency,
  lines,
  units,
}: {
  settlementId: string;
  currency: string;
  lines: EditorLine[];
  units: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditorLine | null>(null);

  function add(v: {
    line_type: LineType;
    description: string;
    amount: number;
    sign: "+" | "-";
    unit_id: string | null;
  }) {
    if (!v.description || !(v.amount > 0)) {
      toast.error("Completá descripción e importe (> 0)");
      return;
    }
    start(async () => {
      try {
        await addSettlementLine({ settlement_id: settlementId, ...v });
        toast.success("Ajuste agregado");
        setAddOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function edit(
    id: string,
    v: {
      line_type: LineType;
      description: string;
      amount: number;
      sign: "+" | "-";
      unit_id: string | null;
    },
  ) {
    start(async () => {
      try {
        await updateSettlementLine({ id, ...v });
        toast.success("Línea actualizada");
        setEditing(null);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      try {
        await deleteSettlementLine(id);
        toast.success("Línea eliminada");
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">Editar líneas</h2>
          <Badge variant="secondary" className="text-[10px] font-normal">
            borrador
          </Badge>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus size={14} /> Agregar ajuste
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Agregar ajuste manual</DialogTitle>
            </DialogHeader>
            <LineForm units={units} onSubmit={add} pending={pending} />
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Los ajustes manuales se conservan al regenerar la liquidación. Editar
        una línea auto la fija como manual.
      </p>

      <div className="divide-y rounded-lg border">
        {lines.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            Sin líneas todavía.
          </p>
        )}
        {lines.map((l) => {
          const lm = SETTLEMENT_LINE_META[l.line_type];
          return (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: lm?.color ?? "#64748b" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate flex items-center gap-2">
                  {l.description}
                  {l.is_manual && (
                    <Badge
                      variant="secondary"
                      className="text-[9px] h-4 px-1 font-normal"
                    >
                      manual
                    </Badge>
                  )}
                </div>
                {l.unitCode && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {l.unitCode}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "tabular-nums text-sm font-medium shrink-0",
                  l.sign === "+"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                {l.sign === "+" ? "+" : "−"}
                {formatMoney(l.amount, currency)}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Dialog
                  open={editing?.id === l.id}
                  onOpenChange={(o) => setEditing(o ? l : null)}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Editar"
                    >
                      <Pencil size={13} />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Editar línea</DialogTitle>
                    </DialogHeader>
                    <LineForm
                      initial={l}
                      units={units}
                      pending={pending}
                      onSubmit={(v) => edit(l.id, v)}
                    />
                  </DialogContent>
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-rose-600"
                      aria-label="Eliminar"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar la línea?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{l.description}” — esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => remove(l.id)}
                        className="bg-rose-600 hover:bg-rose-700"
                      >
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
