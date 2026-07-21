"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Wallet, Wrench } from "lucide-react";
import { toast } from "sonner";
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
import { registerTicketPayment } from "@/lib/actions/tickets";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { todayYmdInTz, zonedTimeToUtc } from "@/lib/dates";
import type { CashAccount } from "@/lib/types/database";

type AccountLite = Pick<CashAccount, "id" | "name" | "currency" | "type" | "is_expense_default">;

export function TicketPaymentDialog({
  ticketId,
  currency,
  actualCost,
  accounts,
  defaultAccountId,
  onPaid,
}: {
  ticketId: string;
  currency: string;
  actualCost: number | null;
  accounts: AccountLite[];
  defaultAccountId: string | null;
  onPaid?: (movementId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const eligible = accounts.filter((a) => a.currency === currency);
  const [amount, setAmount] = useState(actualCost && actualCost > 0 ? String(actualCost) : "");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayYmdInTz());
  const [notes, setNotes] = useState("");

  function reset() {
    setAmount(actualCost && actualCost > 0 ? String(actualCost) : "");
    setAccountId(defaultAccountId && eligible.some((a) => a.id === defaultAccountId) ? defaultAccountId : eligible[0]?.id ?? "");
    setDate(todayYmdInTz());
    setNotes("");
  }

  function submit() {
    const n = parseAmountInput(amount);
    if (n == null || n <= 0) {
      toast.error("Ingresá el importe pagado");
      return;
    }
    if (!accountId) {
      toast.error("Elegí la cuenta de caja");
      return;
    }
    start(async () => {
      try {
        const res = await registerTicketPayment({
          ticket_id: ticketId,
          account_id: accountId,
          amount: n,
          paid_at: date ? zonedTimeToUtc(date, "12:00").toISOString() : undefined,
          notes: notes.trim() || undefined,
        });
        toast.success(`Pago de ${formatMoney(n, currency)} registrado`, {
          description: "Se creó el egreso en Caja.",
        });
        setOpen(false);
        onPaid?.(res.movement_id);
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
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700">
          <Wallet size={14} /> Registrar pago
          {actualCost != null && actualCost > 0 && (
            <span className="ml-auto text-[10px] opacity-80 tabular-nums font-mono">
              {formatMoney(actualCost, currency)}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Wrench size={16} />
            </span>
            Pagar reparación
          </DialogTitle>
          <DialogDescription>
            Registra el egreso real en Caja (pago al técnico/materiales).
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay cuentas de Caja activas en {currency}.{" "}
            <Link href="/dashboard/caja" className="underline hover:no-underline">
              Creá una en Caja
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4 mt-1">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-pay-amount">Importe pagado ({currency})</Label>
                <Input
                  id="ticket-pay-amount"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-10 text-lg tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-pay-date">Fecha</Label>
                <Input
                  id="ticket-pay-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Cuenta de caja</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder={`Elegí cuenta en ${currency}…`} />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span>{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">· {a.type}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Nota (opcional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Proveedor, factura, detalle…"
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
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
            Registrar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
