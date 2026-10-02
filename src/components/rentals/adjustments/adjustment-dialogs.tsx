"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseAmountInput } from "@/lib/format";
import { overrideAdjustment, skipAdjustment } from "@/lib/actions/rentals-adjustments";
import { formatVariation, plainMoney, shortDate } from "./adjustment-text";
import type { AdjustmentView } from "./adjustment-view";

function editable(n: number | null): string {
  if (n == null) return "";
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Fijar a mano el monto que rige desde el ajuste (o cargarlo, si el contrato se ajusta a mano). */
export function OverrideDialog({
  adj,
  today,
  open,
  onOpenChange,
}: {
  adj: AdjustmentView;
  today: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const loadOnly = adj.status === "pendiente_manual";
  const [amount, setAmount] = useState(() => editable(adj.appliedAmount ?? adj.computedAmount));
  const [reason, setReason] = useState(() => adj.overrideReason ?? (loadOnly ? "Monto acordado para este período" : ""));
  const parsed = parseAmountInput(amount);
  const pct = parsed != null && adj.baseAmount ? Math.round((parsed / adj.baseAmount - 1) * 10000) / 100 : null;
  const started = adj.effectiveDate <= today;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed == null || parsed <= 0) {
      toast.error("Ingresá un monto válido", { description: "Por ejemplo 543.500 o 543500,50." });
      return;
    }
    startTransition(async () => {
      const res = await overrideAdjustment(adj.id, { amount: parsed, reason });
      if (!res.ok) {
        toast.error("No se pudo guardar el monto", { description: res.error });
        return;
      }
      toast.success(`Desde el ${shortDate(adj.effectiveDate)} rige ${plainMoney(res.amount, adj.currency)}`, {
        description: res.retroactive ? "Revisá la cuenta corriente por si algún cargo salió con el monto anterior." : "Los próximos cargos ya salen con este monto.",
      });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <PencilLine size={16} />
            </span>
            {loadOnly ? "Cargar el monto del ajuste" : "Corregir el monto"}
          </DialogTitle>
          <DialogDescription>
            Rige desde el {shortDate(adj.effectiveDate)}
            {adj.baseAmount != null ? ` · hoy paga ${plainMoney(adj.baseAmount, adj.currency)}` : ""}
            {adj.computedAmount != null && !loadOnly ? ` · el cálculo da ${plainMoney(adj.computedAmount, adj.currency)}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`ov-amount-${adj.id}`}>Alquiler nuevo ({adj.currency})</Label>
            <Input
              id={`ov-amount-${adj.id}`}
              type="text"
              inputMode="decimal"
              autoFocus
              placeholder="0,00"
              className="h-10 text-lg tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground min-h-4" aria-live="polite">
              {amount && parsed == null ? "Revisá el número." : pct != null ? `${formatVariation(pct)} sobre lo que paga hoy.` : ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ov-reason-${adj.id}`}>Motivo</Label>
            <Textarea
              id={`ov-reason-${adj.id}`}
              rows={2}
              maxLength={300}
              placeholder="Ej.: acordado con el inquilino por WhatsApp el 28/11"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Queda en el historial del contrato.</p>
          </div>
          {started && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Este ajuste ya empezó a regir: revisá la cuenta corriente por si algún cargo salió con el monto anterior.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" className="gap-2" disabled={pending}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              Guardar monto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** No aplicar un ajuste: el precio sigue igual y el siguiente parte de ahí. */
export function SkipDialog({ adj, open, onOpenChange }: { adj: AdjustmentView; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await skipAdjustment(adj.id, reason);
      if (!res.ok) {
        toast.error("No se pudo marcar el ajuste", { description: res.error });
        return;
      }
      toast.success("Listo: este ajuste no se aplica", { description: "El próximo ajuste parte del alquiler de hoy." });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
              <Ban size={16} />
            </span>
            No aplicar este ajuste
          </DialogTitle>
          <DialogDescription>
            {adj.baseAmount != null ? `El alquiler sigue en ${plainMoney(adj.baseAmount, adj.currency)}` : "El alquiler sigue igual"} desde el{" "}
            {shortDate(adj.effectiveDate)} y el ajuste siguiente se calcula desde ese monto. Lo podés deshacer después.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`skip-reason-${adj.id}`}>Motivo</Label>
            <Textarea
              id={`skip-reason-${adj.id}`}
              rows={2}
              maxLength={300}
              autoFocus
              placeholder="Ej.: el propietario decidió congelar el precio este trimestre"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="secondary" className="gap-2" disabled={pending || reason.trim().length < 3}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              No aplicar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
