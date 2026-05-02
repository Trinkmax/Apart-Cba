"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { markScheduleAsPaid } from "@/lib/actions/payment-schedule";
import type {
  BookingPaymentSchedule,
  CashAccount,
} from "@/lib/types/database";

interface MarkPaidDialogProps {
  schedule: BookingPaymentSchedule;
  accounts: Pick<CashAccount, "id" | "name" | "currency" | "type">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid?: () => void;
}

export function MarkPaidDialog({
  schedule,
  accounts,
  open,
  onOpenChange,
  onPaid,
}: MarkPaidDialogProps) {
  const router = useRouter();
  const remaining = Math.max(
    0,
    Number(schedule.expected_amount) - Number(schedule.paid_amount ?? 0)
  );
  const [amount, setAmount] = useState<string>(remaining.toFixed(2));
  const [accountId, setAccountId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [paidAt, setPaidAt] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [isPending, startTransition] = useTransition();

  const accountsForCurrency = accounts.filter(
    (a) => a.currency === schedule.currency
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(amount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("El importe debe ser mayor a 0");
      return;
    }
    if (!accountId) {
      toast.error("Elegí una cuenta de caja");
      return;
    }
    startTransition(async () => {
      try {
        await markScheduleAsPaid({
          schedule_id: schedule.id,
          amount: num,
          account_id: accountId,
          paid_at: paidAt
            ? new Date(paidAt + "T12:00:00").toISOString()
            : null,
          notes: notes.trim() || null,
        });
        toast.success("Cuota marcada como pagada", {
          description:
            num >= remaining - 0.01 ? "Cuota saldada" : "Pago parcial registrado",
        });
        onOpenChange(false);
        onPaid?.();
        router.refresh();
      } catch (err) {
        toast.error("Error", { description: (err as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-7 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
              <CalendarCheck size={15} />
            </span>
            Cobrar cuota {schedule.sequence_number}/{schedule.total_count}
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              Vencía el{" "}
              <span className="font-medium text-foreground">
                {schedule.due_date}
              </span>{" "}
              · Esperado{" "}
              <span className="font-mono text-foreground">
                {schedule.currency}{" "}
                {Number(schedule.expected_amount).toLocaleString("es-AR", {
                  maximumFractionDigits: 2,
                })}
              </span>
            </span>
            {Number(schedule.paid_amount ?? 0) > 0 && (
              <span className="block text-xs">
                Ya cobrado:{" "}
                <span className="font-mono">
                  {schedule.currency}{" "}
                  {Number(schedule.paid_amount).toLocaleString("es-AR", {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="amount">Importe a cobrar ({schedule.currency})</Label>
            <Input
              id="amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={remaining.toFixed(2)}
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Saldo pendiente:{" "}
              <span className="font-mono">
                {schedule.currency}{" "}
                {remaining.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="account_id" className="flex items-center gap-1.5">
              <Wallet size={13} /> Cuenta de caja
            </Label>
            {accountsForCurrency.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                No hay cuentas activas en {schedule.currency}. Cargá una en Caja.
              </p>
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="account_id">
                  <SelectValue placeholder={`Elegí cuenta en ${schedule.currency}…`} />
                </SelectTrigger>
                <SelectContent>
                  {accountsForCurrency.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{" "}
                      <span className="text-[10px] text-muted-foreground ml-1">
                        · {a.type}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="paid_at">Fecha del cobro</Label>
            <Input
              id="paid_at"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Transferencia recibida, recibo #123"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending || accountsForCurrency.length === 0}
              className="gap-1.5"
            >
              {isPending && <Loader2 className="animate-spin" size={14} />}
              Registrar cobro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
