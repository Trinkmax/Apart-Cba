"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, Undo2, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { getExpenseFormOptions, payExpenseFromCaja, unpayExpense, voidExpense } from "@/lib/actions/rentals-expenses";
import type { RentalExpense } from "@/lib/types/database";
import { FieldLabel } from "./expense-form-fields";
import type { ExpenseAccountOption } from "./types";

/** Diálogos controlados de las acciones de un gasto (se abren desde el menú de la fila). */

type Base = { expense: RentalExpense | null; onOpenChange: (open: boolean) => void };

export function PayExpenseDialog({ expense, onOpenChange }: Base) {
  return (
    <Dialog open={!!expense} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <Wallet size={16} />
            </span>
            Pagar desde Caja
          </DialogTitle>
          <DialogDescription>
            {expense ? `${expense.description} · ${formatMoney(expense.amount, expense.currency)}. ` : ""}Se registra un egreso en la cuenta que elijas.
          </DialogDescription>
        </DialogHeader>
        {expense && <PayExpenseBody key={expense.id} expense={expense} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PayExpenseBody({ expense, onClose }: { expense: RentalExpense; onClose: () => void }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ExpenseAccountOption[] | null>(null);
  const [today, setToday] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getExpenseFormOptions(expense.property_id).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.error);
      const list = res.options.accounts.filter((a) => a.currency === expense.currency);
      setAccounts(list);
      setToday(res.options.today);
      setPaidAt(res.options.today);
      setAccountId(list[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [expense.property_id, expense.currency]);

  function confirm() {
    if (!accountId) return setError("Elegí de qué cuenta sale la plata.");
    start(async () => {
      const res = await payExpenseFromCaja(expense.id, { accountId, paidAt });
      if (!res.ok) {
        setError(res.error);
        toast.error("No se pudo registrar el pago", { description: res.error });
        return;
      }
      toast.success(`Pago registrado en Caja (${res.accountName})`, { description: `${formatMoney(expense.amount, expense.currency)} · ${expense.description}` });
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      {accounts === null && !error ? (
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
      ) : accounts && accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No hay cuentas activas en {expense.currency}. Creá una en Caja para registrar el pago.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <FieldLabel>Sale de la cuenta</FieldLabel>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-10 w-full" aria-label="Cuenta de Caja">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="pay-exp-date">Fecha</FieldLabel>
            <Input id="pay-exp-date" type="date" value={paidAt} max={today || undefined} onChange={(e) => setPaidAt(e.target.value)} className="h-10" />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={confirm} disabled={pending || !accounts?.length} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />} Registrar egreso
        </Button>
      </DialogFooter>
    </>
  );
}

export function VoidExpenseDialog({ expense, accountName, onOpenChange }: Base & { accountName?: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close(open: boolean) {
    if (!open) {
      setReason("");
      setError(null);
    }
    onOpenChange(open);
  }

  function confirm() {
    if (!expense) return;
    if (reason.trim().length < 3) return setError("Contá brevemente por qué se anula.");
    start(async () => {
      const res = await voidExpense(expense.id, { reason });
      if (!res.ok) {
        setError(res.error);
        toast.error("No se pudo anular el gasto", { description: res.error });
        return;
      }
      toast.success("Gasto anulado", { description: expense.cash_movement_id ? "También se borró el egreso de Caja." : expense.description });
      close(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={!!expense} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <Ban size={16} />
            </span>
            Anular gasto
          </DialogTitle>
          <DialogDescription>
            {expense ? `${expense.description} · ${formatMoney(expense.amount, expense.currency)}` : ""}. Deja de descontarse y de cobrarse; queda en el historial.
          </DialogDescription>
        </DialogHeader>
        {expense?.cash_movement_id && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Este gasto se pagó desde Caja{accountName ? ` (${accountName})` : ""}: al anularlo también se borra ese egreso. Si la plata realmente salió, mejor editá a cargo de quién va.
          </p>
        )}
        <div className="space-y-1.5">
          <FieldLabel htmlFor="void-exp-reason">Motivo</FieldLabel>
          <Textarea id="void-exp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Ej.: se cargó dos veces" autoFocus />
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            Volver
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Anular gasto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnpayExpenseDialog({ expense, accountName, onOpenChange }: Base & { accountName?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function confirm() {
    if (!expense) return;
    start(async () => {
      const res = await unpayExpense(expense.id);
      if (!res.ok) {
        toast.error("No se pudo deshacer el pago", { description: res.error });
        return;
      }
      toast.success("Pago deshecho", { description: "Se borró el egreso de Caja; el gasto queda sin pagar." });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={!!expense} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <Undo2 size={16} />
            </span>
            Deshacer el pago
          </DialogTitle>
          <DialogDescription>
            Se borra el egreso de {expense ? formatMoney(expense.amount, expense.currency) : ""}
            {accountName ? ` de la cuenta ${accountName}` : ""}. El gasto sigue cargado, como “sin pagar”, y lo podés volver a pagar cuando quieras.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Volver
          </Button>
          <Button onClick={confirm} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Deshacer pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
