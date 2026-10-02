"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createExtraCharge } from "@/lib/actions/rentals-collections";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { ITEM_KIND_LABEL, PAYEE_LABEL } from "@/lib/rentals/labels";
import { addDays } from "@/lib/rentals/ymd";
import type { RentalPayee } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { DEFAULT_PAYEE, MANUAL_KINDS, PAYEES, type ManualKind } from "./charge-dialogs";
import { Spinner } from "./whatsapp-message-dialog";

type Row = { key: number; kind: ManualKind; description: string; amountText: string; payee: RentalPayee };

const SUGGESTIONS = ["Reparación", "Diferencia de expensas", "Gastos de salida", "Reintegro de servicios"];

/** Cargo aparte del mensual (una reparación, gastos de salida…). Envuelve al botón que lo abre. */
export function ExtraChargeDialog({ contractId, currency, today, children }: { contractId: string; currency: string; today: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState(addDays(today, 10));
  const [kind, setKind] = useState<"extra" | "salida">("extra");
  const [rows, setRows] = useState<Row[]>([{ key: 1, kind: "reparacion", description: "", amountText: "", payee: DEFAULT_PAYEE.reparacion }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = rows.reduce((s, r) => s + (parseAmountInput(r.amountText) ?? 0), 0);

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submit() {
    const items: { kind: ManualKind; payee: RentalPayee; amount: number; description: string }[] = [];
    for (const r of rows) {
      const amount = parseAmountInput(r.amountText);
      if (amount == null || amount <= 0) {
        setError("Revisá los importes: todos tienen que ser mayores a cero.");
        return;
      }
      items.push({ kind: r.kind, payee: r.payee, amount, description: r.description.trim() || `${ITEM_KIND_LABEL[r.kind]}${label.trim() ? ` · ${label.trim()}` : ""}` });
    }
    if (label.trim().length < 3) {
      setError("Poné un nombre al cargo (por ejemplo: Reparación del calefón).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createExtraCharge(contractId, { label: label.trim(), dueDate, kind, items });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Cargo creado", { description: `${label.trim()}: ${formatMoney(total, currency)}` });
      setOpen(false);
      setLabel("");
      setRows([{ key: Date.now(), kind: "reparacion", description: "", amountText: "", payee: DEFAULT_PAYEE.reparacion }]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0">
              <FilePlus2 size={16} />
            </span>
            Nuevo cargo
          </DialogTitle>
          <DialogDescription>Para cobrarle al inquilino algo fuera del alquiler del mes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="xc-label">Nombre del cargo</Label>
            <Input id="xc-label" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: Reparación del calefón" />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setLabel(s)} className="rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 min-h-7">
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xc-due">Vence</Label>
            <Input id="xc-due" type="date" className="h-10" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5 self-start" role="radiogroup" aria-label="Tipo de cargo">
          {([
            { v: "extra", label: "Cargo extra" },
            { v: "salida", label: "Gastos de salida" },
          ] as const).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={kind === o.v}
              onClick={() => setKind(o.v)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium min-h-7", kind === o.v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="rounded-lg border p-2.5 grid gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_8rem_9rem_auto] sm:items-center">
              <Select value={r.kind} onValueChange={(v) => update(r.key, { kind: v as ManualKind, payee: DEFAULT_PAYEE[v as ManualKind] })}>
                <SelectTrigger className="h-9 w-full" aria-label="Qué es">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {ITEM_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={r.description} maxLength={200} onChange={(e) => update(r.key, { description: e.target.value })} placeholder="Detalle (opcional)" className="h-9" aria-label="Detalle" />
              <Input type="text" inputMode="decimal" placeholder="0,00" value={r.amountText} onChange={(e) => update(r.key, { amountText: e.target.value })} className="h-9 tabular-nums" aria-label="Importe" />
              <Select value={r.payee} onValueChange={(v) => update(r.key, { payee: v as RentalPayee })}>
                <SelectTrigger className="h-9 w-full" aria-label="De quién es la plata">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYEES.map((p) => (
                    <SelectItem key={p} value={p}>
                      Para: {PAYEE_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-sm" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Sacar concepto">
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRows((rs) => [...rs, { key: Date.now(), kind: "otro", description: "", amountText: "", payee: DEFAULT_PAYEE.otro }])}>
              <Plus size={14} /> Otro concepto
            </Button>
            <p className="text-sm">
              Total <span className="font-semibold tabular-nums">{formatMoney(total, currency)}</span>
            </p>
          </div>
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Spinner /> : <FilePlus2 size={14} />} Crear cargo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
