"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { generateSettlement } from "@/lib/actions/settlements";
import type { Owner } from "@/lib/types/database";

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface Props {
  children: React.ReactNode;
  owners: Owner[];
}

export function GenerateSettlementDialog({ children, owners }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const now = new Date();
  const [ownerId, setOwnerId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [currency, setCurrency] = useState("ARS");

  function handleGenerate() {
    if (!ownerId) {
      toast.error("Seleccioná un propietario");
      return;
    }
    startTransition(async () => {
      try {
        const result = await generateSettlement(ownerId, year, month, currency);
        toast.success("Liquidación generada", {
          description: `${result.lines.length} líneas · neto: ${result.settlement.net_payable.toFixed(2)} ${currency}`,
        });
        setOpen(false);
        router.push(`/dashboard/liquidaciones/${result.settlement.id}`);
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
          <DialogTitle>Generar liquidación</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Propietario</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Año</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Mes</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Moneda de la liquidación</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ARS">ARS</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Solo se incluyen reservas en esta moneda. Si el propietario tiene reservas mixtas, generá una liquidación por moneda.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleGenerate} disabled={isPending} className="gap-2">
            {isPending ? <Loader2 className="animate-spin" /> : <Sparkles size={14} />}
            Generar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
