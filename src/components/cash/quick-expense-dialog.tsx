"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ArrowUpFromLine, Wallet, Star, Building, User2 } from "lucide-react";
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
import { UnitCombobox } from "@/components/ui/unit-combobox";
import { registerExpense, type QuickExpenseInput } from "@/lib/actions/cash";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { todayYmdInTz, zonedTimeToUtc } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CashAccount, Unit } from "@/lib/types/database";

type ExpenseCategory = NonNullable<QuickExpenseInput["category"]>;

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "supplies", label: "Insumos" },
  { value: "utilities", label: "Servicios (luz, gas, agua)" },
  { value: "maintenance", label: "Mantenimiento" },
  { value: "cleaning", label: "Limpieza" },
  { value: "salary", label: "Sueldos" },
  { value: "tax", label: "Impuestos" },
  { value: "other", label: "Otro" },
];

export function QuickExpenseDialog({
  accounts,
  defaultAccountId,
  units = [],
  children,
}: {
  accounts: (Pick<CashAccount, "id" | "name" | "currency" | "type"> & {
    is_expense_default?: boolean;
  })[];
  defaultAccountId: string | null;
  units?: Pick<Unit, "id" | "code" | "name">[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const initialAccount = defaultAccountId ?? accounts[0]?.id ?? "";
  const [accountId, setAccountId] = useState(initialAccount);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayYmdInTz());
  const [billableTo, setBillableTo] = useState<"apartcba" | "owner">("apartcba");
  const [unitId, setUnitId] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const currency = selectedAccount?.currency ?? "ARS";

  function reset() {
    setAccountId(defaultAccountId ?? accounts[0]?.id ?? "");
    setAmount("");
    setCategory("supplies");
    setDescription("");
    setDate(todayYmdInTz());
    setBillableTo("apartcba");
    setUnitId(null);
  }

  function submit() {
    const n = parseAmountInput(amount);
    if (n == null || n <= 0) {
      toast.error("Ingresá un importe válido");
      return;
    }
    if (!accountId) {
      toast.error("Elegí una cuenta");
      return;
    }
    if (billableTo === "owner" && !unitId) {
      toast.error("Elegí el depto para descontarlo al propietario");
      return;
    }
    start(async () => {
      try {
        await registerExpense({
          account_id: accountId,
          amount: n,
          category,
          description: description.trim() || null,
          occurred_at: date ? zonedTimeToUtc(date, "12:00").toISOString() : undefined,
          billable_to: billableTo,
          unit_id: billableTo === "owner" ? unitId : null,
        });
        toast.success(`Gasto de ${formatMoney(n, currency)} registrado`, {
          description: `Debitado de ${selectedAccount?.name ?? "la cuenta"}.`,
        });
        reset();
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo registrar el gasto", {
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
            <span className="size-8 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <ArrowUpFromLine size={16} />
            </span>
            Registrar gasto
          </DialogTitle>
          <DialogDescription>
            Gasto rápido del día a día. Genera un egreso en Caja al instante.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay cuentas de Caja activas.{" "}
            <Link href="/dashboard/caja" className="underline hover:no-underline">
              Creá una en Caja
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4 mt-1">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="expense-amount">Importe ({currency})</Label>
                <Input
                  id="expense-amount"
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
                <Label htmlFor="expense-date">Fecha</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Cuenta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir cuenta…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        {a.is_expense_default && (
                          <Star size={11} className="text-amber-500 fill-amber-500" />
                        )}
                        <span>{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">· {a.currency}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccount?.is_expense_default && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Wallet size={10} /> Cuenta de gastos corrientes
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {units.length > 0 && (
              <div className="space-y-1.5">
                <Label>¿Quién lo paga?</Label>
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
                {billableTo === "owner" && (
                  <div className="pt-1 space-y-1">
                    <UnitCombobox
                      units={units}
                      value={unitId ?? ""}
                      onChange={(id) => setUnitId(id ?? null)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Se descuenta en la liquidación del dueño principal de este depto.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="expense-desc">Concepto</Label>
              <Textarea
                id="expense-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ferretería, factura de luz, propina…"
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
            disabled={pending || accounts.length === 0}
            className="gap-2 bg-rose-600 hover:bg-rose-700"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ArrowUpFromLine size={14} />
            )}
            Registrar gasto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
