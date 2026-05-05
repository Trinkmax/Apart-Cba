"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Wallet, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addBookingPayment } from "@/lib/actions/bookings";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashAccount } from "@/lib/types/database";

type AccountLite = Pick<CashAccount, "id" | "name" | "currency" | "type">;

interface QuickPayCardProps {
  bookingId: string;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  accounts: AccountLite[];
  /** Cuando la reserva está cancelada/no_show, deshabilitamos el cobro. */
  disabled?: boolean;
}

/**
 * Card de pago rápido. Visible cuando la reserva tiene saldo pendiente:
 * permite cargar un cobro y elegir cuenta de caja sin abrir el form completo
 * de edición. Tras el éxito, refresca la ruta para que la tarjeta de pago se
 * actualice con el nuevo total cobrado.
 */
export function QuickPayCard({
  bookingId,
  currency,
  totalAmount,
  paidAmount,
  accounts,
  disabled = false,
}: QuickPayCardProps) {
  const router = useRouter();
  const pendingAmount = Math.max(0, Number(totalAmount) - Number(paidAmount));
  const matchingAccounts = accounts.filter((a) => a.currency === currency);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  if (disabled) return null;

  function openForm() {
    setAmount(pendingAmount > 0 ? String(pendingAmount) : "");
    setAccountId(matchingAccounts[0]?.id ?? "");
    setOpen(true);
  }

  function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Ingresá un importe válido");
      return;
    }
    if (!accountId) {
      toast.error("Elegí una cuenta de caja");
      return;
    }
    startTransition(async () => {
      try {
        await addBookingPayment(bookingId, n, accountId);
        toast.success(`Pago de ${formatMoney(n, currency)} registrado`);
        setOpen(false);
        setAmount("");
        router.refresh();
      } catch (e) {
        toast.error("No se pudo registrar el pago", {
          description: (e as Error).message,
        });
      }
    });
  }

  // Saldo cero → mostramos un estado consolidado, sin abrir form.
  if (pendingAmount <= 0) {
    return (
      <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800/40 px-3 py-2 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 size={14} className="shrink-0" />
        <span>Reserva saldada</span>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        className="w-full gap-1.5"
        onClick={openForm}
      >
        <Plus size={14} /> Registrar pago
        <span className="ml-auto text-[10px] opacity-80 tabular-nums font-mono">
          {formatMoney(pendingAmount, currency)}
        </span>
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200 text-[11px] uppercase tracking-wider font-semibold">
          <Wallet size={12} /> Nuevo pago
        </Label>
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </button>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label
            htmlFor="quick-pay-amount"
            className="text-[10px] text-emerald-900/80 dark:text-emerald-200/80"
          >
            Importe ({currency})
          </Label>
          <Input
            id="quick-pay-amount"
            type="text"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(pendingAmount)}
            className="h-9"
          />
        </div>
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          disabled={isPending}
          onClick={submit}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Cobrar
        </Button>
      </div>

      <div className="space-y-1">
        <Label
          htmlFor="quick-pay-account"
          className="text-[10px] text-emerald-900/80 dark:text-emerald-200/80"
        >
          Cuenta de caja
        </Label>
        {matchingAccounts.length === 0 ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            No hay cuentas activas en {currency}.{" "}
            <Link href="/dashboard/caja" className="underline hover:no-underline">
              Crear una en Caja
            </Link>
            .
          </p>
        ) : (
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="quick-pay-account" className="h-9">
              <SelectValue placeholder={`Elegí cuenta en ${currency}…`} />
            </SelectTrigger>
            <SelectContent>
              {matchingAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-2">
                    <span>{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">· {a.type}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-emerald-900/70 dark:text-emerald-200/70">
        <button
          type="button"
          className={cn(
            "underline-offset-2 hover:underline",
            amount === String(pendingAmount) && "opacity-60 cursor-default"
          )}
          onClick={() => setAmount(String(pendingAmount))}
          disabled={amount === String(pendingAmount)}
        >
          Saldar {formatMoney(pendingAmount, currency)}
        </button>
        <span className="tabular-nums">
          Saldo actual:{" "}
          <span className="font-semibold">
            {formatMoney(pendingAmount, currency)}
          </span>
        </span>
      </div>
    </div>
  );
}
