"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  ChevronsUpDown,
  Check,
  X,
} from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createMovement, type MovementInput } from "@/lib/actions/cash";
import { cn } from "@/lib/utils";
import type { CashAccount, Unit } from "@/lib/types/database";

type UnitForMovement = Pick<Unit, "id" | "code" | "name">;

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
  /** Unidades disponibles para imputar el movimiento (opcional). */
  units?: UnitForMovement[];
}

export function MovementFormDialog({ children, accounts, units = [] }: Props) {
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

  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const selectedUnit = useMemo(
    () => units.find((u) => u.id === form.unit_id) ?? null,
    [units, form.unit_id]
  );

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

          {/* Unidad — opcional. Permite imputar el movimiento a una unidad puntual
              (ej.: pintura para Independencia 369). Aparece después en filtros y
              en la liquidación al propietario si la unidad está vinculada. */}
          {units.length > 0 && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Building2 size={13} className="text-muted-foreground" />
                Unidad
                <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                  (opcional)
                </span>
              </Label>
              <div className="flex gap-1.5">
                <Popover open={unitPickerOpen} onOpenChange={setUnitPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={unitPickerOpen}
                      className={cn(
                        "flex-1 justify-between font-normal",
                        !selectedUnit && "text-muted-foreground"
                      )}
                    >
                      {selectedUnit ? (
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded bg-muted">
                            {selectedUnit.code}
                          </span>
                          <span className="truncate">{selectedUnit.name}</span>
                        </span>
                      ) : (
                        "Sin unidad asignada"
                      )}
                      <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Buscar por código o nombre…" />
                      <CommandList>
                        <CommandEmpty>Sin coincidencias</CommandEmpty>
                        <CommandGroup>
                          {units.map((u) => {
                            const active = form.unit_id === u.id;
                            return (
                              <CommandItem
                                key={u.id}
                                value={`${u.code} ${u.name}`}
                                onSelect={() => {
                                  set("unit_id", u.id);
                                  setUnitPickerOpen(false);
                                }}
                                className="flex items-center gap-2"
                              >
                                <Check
                                  size={13}
                                  className={cn(
                                    "shrink-0",
                                    active ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="font-mono text-xs shrink-0 px-1.5 py-0.5 rounded bg-muted">
                                  {u.code}
                                </span>
                                <span className="truncate">{u.name}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedUnit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar unidad"
                    onClick={() => set("unit_id", null)}
                    className="shrink-0"
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            </div>
          )}

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
