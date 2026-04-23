"use client";

import { useState, useTransition, useMemo } from "react";
import { Loader2, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createMovement, type MovementInput } from "@/lib/actions/cash";
import { cn } from "@/lib/utils";
import type { CashAccount } from "@/lib/types/database";

const CATEGORY_LABELS: Record<MovementInput["category"], string> = {
  booking_payment: "Cobro de reserva",
  maintenance: "Mantenimiento",
  cleaning: "Limpieza",
  owner_settlement: "Liquidación a propietario",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  salary: "Sueldo",
  utilities: "Servicios (luz, gas, agua)",
  tax: "Impuestos",
  supplies: "Insumos",
  commission: "Comisión",
  refund: "Devolución",
  other: "Otro",
};

interface Props {
  children: React.ReactNode;
  accounts: CashAccount[];
}

export function MovementFormDialog({ children, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [form, setForm] = useState<MovementInput>({
    account_id: accounts[0]?.id ?? "",
    direction: "in",
    amount: 0,
    currency: accounts[0]?.currency ?? "ARS",
    category: "other",
    unit_id: null,
    owner_id: null,
    description: "",
  });

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === form.account_id),
    [accounts, form.account_id]
  );

  function set<K extends keyof MovementInput>(k: K, v: MovementInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createMovement({ ...form, currency: selectedAccount?.currency ?? form.currency });
        toast.success("Movimiento registrado");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Toggle in/out */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => set("direction", "in")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg p-3 border-2 transition-all",
                form.direction === "in"
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-border hover:border-emerald-500/50"
              )}
            >
              <ArrowDownToLine size={16} />
              <span className="font-medium">Ingreso</span>
            </button>
            <button
              type="button"
              onClick={() => set("direction", "out")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg p-3 border-2 transition-all",
                form.direction === "out"
                  ? "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                  : "border-border hover:border-rose-500/50"
              )}
            >
              <ArrowUpFromLine size={16} />
              <span className="font-medium">Egreso</span>
            </button>
          </div>

          <div className="space-y-1.5">
            <Label>Cuenta *</Label>
            <Select value={form.account_id} onValueChange={(v) => {
              set("account_id", v);
              const acc = accounts.find((a) => a.id === v);
              if (acc) set("currency", acc.currency);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Importe *</Label>
              <Input type="number" min="0.01" step="0.01" required value={form.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v as MovementInput["category"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).filter(([k]) => k !== "transfer").map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="Concepto, referencia, factura..." />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
