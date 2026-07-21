"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Wallet, Plus, Trash2, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { registerSettlementPayment } from "@/lib/actions/settlements";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashAccount } from "@/lib/types/database";

type Split = { key: string; account_id: string; amount: string };

let splitSeq = 0;
function newSplit(amount = ""): Split {
  splitSeq += 1;
  return { key: `s${splitSeq}`, account_id: "", amount };
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function RecordPaymentDialog({
  settlementId,
  currency,
  netPayable,
  accounts,
  children,
}: {
  settlementId: string;
  currency: string;
  netPayable: number;
  accounts: CashAccount[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const eligible = useMemo(
    () => accounts.filter((a) => a.currency === currency && a.active),
    [accounts, currency],
  );
  const net = round2(Number(netPayable));

  const [splits, setSplits] = useState<Split[]>([
    { ...newSplit(net > 0 ? net.toFixed(2) : ""), account_id: "" },
  ]);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const total = round2(
    splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
  );
  const remaining = round2(net - total);
  const balanced = Math.abs(remaining) < 0.01;

  function reset() {
    setSplits([{ ...newSplit(net > 0 ? net.toFixed(2) : ""), account_id: "" }]);
    setPaidAt(new Date().toISOString().slice(0, 10));
    setNotes("");
  }

  function updateSplit(key: string, patch: Partial<Split>) {
    setSplits((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addSplit() {
    // La nueva fila arranca con el resto pendiente (si es positivo).
    setSplits((prev) => [
      ...prev,
      newSplit(remaining > 0.005 ? remaining.toFixed(2) : ""),
    ]);
  }

  function removeSplit(key: string) {
    setSplits((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.key !== key)));
  }

  function submit() {
    const rows = splits
      .map((s) => ({ account_id: s.account_id, amount: Number(s.amount) }))
      .filter((s) => s.account_id && Number.isFinite(s.amount) && s.amount > 0);
    if (rows.length === 0) {
      toast.error("Cargá al menos una cuenta con importe");
      return;
    }
    if (splits.some((s) => Number(s.amount) > 0 && !s.account_id)) {
      toast.error("Elegí la cuenta de cada línea");
      return;
    }
    if (!balanced) {
      toast.error("La suma no coincide con el neto", {
        description:
          remaining > 0
            ? `Faltan ${formatMoney(remaining, currency)}`
            : `Te pasaste ${formatMoney(Math.abs(remaining), currency)}`,
      });
      return;
    }
    start(async () => {
      try {
        await registerSettlementPayment({
          settlement_id: settlementId,
          splits: rows,
          paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
          notes: notes.trim() || undefined,
        });
        toast.success("Pago registrado", {
          description:
            rows.length > 1
              ? `Se crearon ${rows.length} egresos en Caja y la liquidación quedó pagada.`
              : "Se creó el egreso en Caja y la liquidación quedó pagada.",
        });
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo registrar el pago", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet size={18} className="text-primary" /> Registrar pago
          </DialogTitle>
          <DialogDescription>
            Crea un egreso en Caja por cada cuenta y marca la liquidación como
            pagada.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay cuentas de Caja activas en {currency}. Creá una en Caja antes
            de registrar el pago.
          </p>
        ) : (
          <div className="space-y-4 mt-1">
            {/* Neto objetivo */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Neto a pagar
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(net, currency)}
              </span>
            </div>

            {/* Líneas de cuentas */}
            <div className="space-y-2">
              {splits.map((s, idx) => (
                <div key={s.key} className="flex items-end gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    {idx === 0 && (
                      <Label className="text-[10px] text-muted-foreground">Cuenta</Label>
                    )}
                    <Select
                      value={s.account_id}
                      onValueChange={(v) => updateSplit(s.key, { account_id: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Elegir cuenta…" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligible.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 space-y-1">
                    {idx === 0 && (
                      <Label className="text-[10px] text-muted-foreground">
                        Importe
                      </Label>
                    )}
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={s.amount}
                      onChange={(e) => updateSplit(s.key, { amount: e.target.value })}
                      placeholder="0,00"
                      className="h-9 tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-rose-600"
                    disabled={splits.length <= 1}
                    onClick={() => removeSplit(s.key)}
                    aria-label="Quitar cuenta"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addSplit}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Plus size={13} /> Agregar cuenta
              </button>
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs tabular-nums",
                  balanced
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              >
                {balanced ? <Check size={13} /> : <AlertTriangle size={13} />}
                {balanced ? (
                  <span>Total {formatMoney(total, currency)}</span>
                ) : remaining > 0 ? (
                  <span>Faltan {formatMoney(remaining, currency)}</span>
                ) : (
                  <span>Excede {formatMoney(Math.abs(remaining), currency)}</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nota (opcional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Referencia de la transferencia…"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || eligible.length === 0 || !balanced}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wallet size={14} />
            )}
            Registrar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
