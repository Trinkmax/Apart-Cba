"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Building, User2, Car } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addBookingExtraCharge } from "@/lib/actions/bookings";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { todayYmdInTz, zonedTimeToUtc } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CashAccount } from "@/lib/types/database";

type AccountLite = Pick<CashAccount, "id" | "name" | "currency" | "type">;

const SUGGESTIONS = ["Cochera", "Late check-out", "Daños", "Consumos", "Early check-in"];

export function ExtraChargeDialog({
  bookingId,
  currency,
  accounts,
  disabled = false,
}: {
  bookingId: string;
  currency: string;
  accounts: AccountLite[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const matchingAccounts = accounts.filter((a) => a.currency === currency);
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [billableTo, setBillableTo] = useState<"apartcba" | "owner">("apartcba");
  const [date, setDate] = useState(todayYmdInTz());

  function reset() {
    setConcept("");
    setAmount("");
    setAccountId(matchingAccounts[0]?.id ?? "");
    setBillableTo("apartcba");
    setDate(todayYmdInTz());
  }

  function submit() {
    const n = parseAmountInput(amount);
    if (!concept.trim() || concept.trim().length < 2) {
      toast.error("Describí el concepto del cobro");
      return;
    }
    if (n == null || n <= 0) {
      toast.error("Ingresá un importe válido");
      return;
    }
    if (!accountId) {
      toast.error("Elegí una cuenta de caja");
      return;
    }
    start(async () => {
      try {
        await addBookingExtraCharge({
          booking_id: bookingId,
          amount: n,
          account_id: accountId,
          concept: concept.trim(),
          billable_to: billableTo,
          occurred_at: date ? zonedTimeToUtc(date, "12:00").toISOString() : undefined,
        });
        toast.success(`Cobro extra de ${formatMoney(n, currency)} registrado`, {
          description: "Se sumó a Caja sin tocar el total de la reserva.",
        });
        reset();
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo registrar el cobro", {
          description: (e as Error).message,
        });
      }
    });
  }

  if (disabled) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full gap-1.5">
          <Car size={14} /> Cobro extra
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Plus size={16} />
            </span>
            Cobro extra
          </DialogTitle>
          <DialogDescription>
            Cochera, late check-out, daños… Ingreso aparte vinculado a la reserva.
            No modifica el total ni el saldo.
          </DialogDescription>
        </DialogHeader>

        {matchingAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay cuentas activas en {currency}.{" "}
            <Link href="/dashboard/caja" className="underline hover:no-underline">
              Creá una en Caja
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="extra-concept">Concepto</Label>
              <Input
                id="extra-concept"
                autoFocus
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Cochera, daños en TV…"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setConcept(s)}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                      concept === s
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                        : "border-border text-muted-foreground hover:border-indigo-500/40",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="extra-amount">Importe ({currency})</Label>
                <Input
                  id="extra-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-10 text-lg tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="extra-date">Fecha</Label>
                <Input
                  id="extra-date"
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
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                ¿A quién corresponde?
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: "apartcba", label: "ApartCBA", icon: <Building size={14} /> },
                    { v: "owner", label: "Propietario", icon: <User2 size={14} /> },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setBillableTo(opt.v)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-lg p-2.5 border-2 transition-all text-xs",
                      billableTo === opt.v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {opt.icon}
                    <span className="font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {billableTo === "apartcba"
                  ? "Ingreso operativo de la organización."
                  : "Se imputa al propietario de la unidad (para tu conciliación)."}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || matchingAccounts.length === 0}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Cobrar extra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
