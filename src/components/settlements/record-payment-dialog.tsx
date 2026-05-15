"use client";

import { useState, useTransition } from "react";
import { Loader2, Wallet } from "lucide-react";
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
import type { CashAccount } from "@/lib/types/database";

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

  const eligible = accounts.filter((a) => a.currency === currency && a.active);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(netPayable.toFixed(2));
  const [paidAt, setPaidAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");

  function submit() {
    if (!accountId) {
      toast.error("Elegí la cuenta de Caja");
      return;
    }
    start(async () => {
      try {
        await registerSettlementPayment({
          settlement_id: settlementId,
          account_id: accountId,
          amount: Number(amount),
          paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
          notes: notes.trim() || undefined,
        });
        toast.success("Pago registrado", {
          description: "Se creó el egreso en Caja y la liquidación quedó pagada.",
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet size={18} className="text-primary" /> Registrar pago
          </DialogTitle>
          <DialogDescription>
            Crea un egreso en Caja y marca la liquidación como pagada.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay cuentas de Caja activas en {currency}. Creá una en Caja
            antes de registrar el pago.
          </p>
        ) : (
          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label>Cuenta de Caja ({currency})</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir cuenta..." />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <p className="text-[10px] text-muted-foreground">
                  Neto: {formatMoney(netPayable, currency)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nota (opcional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Referencia de la transferencia..."
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
            disabled={pending || eligible.length === 0}
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
