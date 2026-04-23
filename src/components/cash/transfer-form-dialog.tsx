"use client";

import { useState, useTransition } from "react";
import { Loader2, ArrowRightLeft } from "lucide-react";
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
import { createTransfer } from "@/lib/actions/cash";
import type { CashAccount } from "@/lib/types/database";

interface Props {
  children: React.ReactNode;
  accounts: CashAccount[];
}

export function TransferFormDialog({ children, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmt, setFromAmt] = useState(0);
  const [toAmt, setToAmt] = useState(0);
  const [rate, setRate] = useState("");
  const [desc, setDesc] = useState("");

  const fromAcc = accounts.find((a) => a.id === fromId);
  const toAcc = accounts.find((a) => a.id === toId);
  const sameCurrency = fromAcc?.currency === toAcc?.currency;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId || !toId || fromId === toId) {
      toast.error("Seleccioná dos cuentas distintas");
      return;
    }
    startTransition(async () => {
      try {
        await createTransfer({
          from_account_id: fromId,
          to_account_id: toId,
          from_amount: fromAmt,
          to_amount: sameCurrency ? fromAmt : toAmt,
          exchange_rate: rate === "" ? undefined : Number(rate),
          description: desc,
        });
        toast.success("Transferencia registrada");
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
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={18} />
            Transferencia entre cuentas
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Desde</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger><SelectValue placeholder="Cuenta origen" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === toId}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Importe a debitar {fromAcc && `(${fromAcc.currency})`}</Label>
            <Input type="number" min="0.01" step="0.01" value={fromAmt || ""} onChange={(e) => setFromAmt(Number(e.target.value))} />
          </div>

          <div className="space-y-1.5">
            <Label>Hacia</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger><SelectValue placeholder="Cuenta destino" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.id === fromId}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!sameCurrency && fromAcc && toAcc && (
            <>
              <div className="space-y-1.5">
                <Label>Importe a acreditar ({toAcc.currency})</Label>
                <Input type="number" min="0.01" step="0.01" value={toAmt || ""} onChange={(e) => setToAmt(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>Cotización ({fromAcc.currency} por cada 1 {toAcc.currency})</Label>
                <Input type="number" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="ej: 1200.5" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Pago dueño, conversión, etc" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              Transferir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
