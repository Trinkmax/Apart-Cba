"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createAccount, type AccountInput } from "@/lib/actions/cash";

const COLORS = ["#0F766E", "#3B82F6", "#A855F7", "#EC4899", "#F59E0B", "#10B981", "#EF4444", "#64748B"];

export function AccountFormDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<AccountInput>({
    name: "",
    type: "efectivo",
    currency: "ARS",
    opening_balance: 0,
    account_number: "",
    bank_name: "",
    notes: "",
    color: "#0F766E",
    icon: "wallet",
  });

  function set<K extends keyof AccountInput>(k: K, v: AccountInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createAccount(form);
        toast.success("Cuenta creada");
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
        <DialogHeader><DialogTitle>Nueva cuenta</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input required autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Caja efectivo, Galicia ARS, MP, USDT..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as AccountInput["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="banco">Banco</SelectItem>
                  <SelectItem value="mp">Mercado Pago</SelectItem>
                  <SelectItem value="crypto">Cripto</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="USDT">USDT</SelectItem>
                  <SelectItem value="USDC">USDC</SelectItem>
                  <SelectItem value="BTC">BTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Saldo inicial</Label>
            <Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => set("opening_balance", Number(e.target.value))} />
          </div>
          {form.type === "banco" && (
            <>
              <div className="space-y-1.5">
                <Label>Banco</Label>
                <Input value={form.bank_name ?? ""} onChange={(e) => set("bank_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Número / CBU</Label>
                <Input value={form.account_number ?? ""} onChange={(e) => set("account_number", e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-8 rounded-md ring-offset-2 transition-all"
                  style={{
                    backgroundColor: c,
                    boxShadow: form.color === c ? `0 0 0 2px ${c}, 0 0 0 4px white` : undefined,
                  }}
                  onClick={() => set("color", c)}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
