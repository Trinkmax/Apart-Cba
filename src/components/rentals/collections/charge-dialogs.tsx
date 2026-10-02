"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgePercent, Ban, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addChargeItem, discountChargeItem } from "@/lib/actions/rentals-collections";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { ITEM_KIND_LABEL, PAYEE_LABEL } from "@/lib/rentals/labels";
import type { RentalChargeItemKind, RentalPayee } from "@/lib/types/database";
import { Spinner } from "./whatsapp-message-dialog";

export const MANUAL_KINDS = ["expensas", "servicio", "reparacion", "honorarios", "punitorio", "deposito", "sellado", "rescision", "otro"] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];
export const PAYEES: RentalPayee[] = ["propietario", "inmobiliaria", "consorcio", "tercero"];

/** De quién suele ser la plata de cada concepto (se puede cambiar). */
export const DEFAULT_PAYEE: Record<ManualKind, RentalPayee> = {
  expensas: "consorcio",
  servicio: "tercero",
  reparacion: "inmobiliaria",
  honorarios: "inmobiliaria",
  punitorio: "propietario",
  deposito: "propietario",
  sellado: "tercero",
  rescision: "propietario",
  otro: "propietario",
};

export const PAYEE_HINT: Record<RentalPayee, string> = {
  propietario: "Se le rinde al propietario.",
  inmobiliaria: "Queda para la inmobiliaria (no se rinde).",
  consorcio: "Se le paga al consorcio.",
  tercero: "Se le paga a un tercero (proveedor, Rentas…).",
};

/** Diálogo genérico "contá por qué" para anular (cobro o cargo). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel,
  placeholder,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  warning?: ReactNode;
  confirmLabel: string;
  placeholder?: string;
  onConfirm: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function confirm() {
    if (reason.trim().length < 3) {
      setError("Contá brevemente por qué (queda en el historial).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onConfirm(reason.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReason("");
      onOpenChange(false);
    });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Ban size={16} />
            </span>
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {warning && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <div>{warning}</div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Motivo</Label>
          <Textarea id="void-reason" rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={placeholder ?? "Ej: se cargó dos veces"} />
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Volver
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending} className="gap-2">
            {pending ? <Spinner /> : <Ban size={14} />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Agregar un concepto a un cargo (expensas, una reparación, intereses…). */
export function AddItemDialog({
  open,
  onOpenChange,
  chargeId,
  chargeLabel,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargeId: string;
  chargeLabel: string;
  currency: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ManualKind>("expensas");
  const [payee, setPayee] = useState<RentalPayee>(DEFAULT_PAYEE.expensas);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function submit() {
    const amount = parseAmountInput(amountText);
    if (amount == null || amount <= 0) {
      setError("Ingresá un importe válido (por ejemplo 85.000).");
      return;
    }
    const desc = description.trim() || `${ITEM_KIND_LABEL[kind]} · ${chargeLabel}`;
    setError(null);
    startTransition(async () => {
      const res = await addChargeItem(chargeId, { kind, payee, description: desc, amount });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Concepto agregado", { description: `${desc}: ${formatMoney(amount, currency)}` });
      setDescription("");
      setAmountText("");
      onOpenChange(false);
      router.refresh();
    });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0">
              <Plus size={16} />
            </span>
            Agregar concepto
          </DialogTitle>
          <DialogDescription>Se suma al cargo {chargeLabel}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Qué es</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as ManualKind);
                setPayee(DEFAULT_PAYEE[v as ManualKind]);
              }}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {ITEM_KIND_LABEL[k as RentalChargeItemKind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="item-amount">Importe ({currency})</Label>
            <Input id="item-amount" type="text" inputMode="decimal" placeholder="0,00" className="h-10 tabular-nums" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="item-desc">Concepto</Label>
          <Input id="item-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder={`${ITEM_KIND_LABEL[kind as RentalChargeItemKind]} · ${chargeLabel}`} />
        </div>
        <div className="space-y-1.5">
          <Label>¿De quién es la plata?</Label>
          <Select value={payee} onValueChange={(v) => setPayee(v as RentalPayee)}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYEES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PAYEE_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{PAYEE_HINT[payee]}</p>
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Spinner /> : <Plus size={14} />} Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bonificar (bajar) un concepto: queda el importe original y el motivo. */
export function DiscountDialog({
  open,
  onOpenChange,
  item,
  chargeLabel,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; description: string; amount: number; paid: number; outstanding: number; kind: RentalChargeItemKind };
  chargeLabel: string;
  currency: string;
}) {
  const router = useRouter();
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amount = parseAmountInput(amountText);
  const after = amount != null ? Math.max(0, Math.round((item.amount - amount) * 100) / 100) : null;
  const quick = [
    { label: "Todo el saldo", value: item.outstanding },
    ...(item.outstanding >= 2 ? [{ label: "La mitad", value: Math.round((item.outstanding / 2) * 100) / 100 }] : []),
  ];
  function submit() {
    if (amount == null || amount <= 0) {
      setError("Ingresá cuánto se bonifica.");
      return;
    }
    if (amount > item.outstanding + 0.004) {
      setError(`Como máximo ${formatMoney(item.outstanding, currency)}: el resto ya se cobró.`);
      return;
    }
    if (reason.trim().length < 3) {
      setError("Contá brevemente por qué (queda en el historial).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await discountChargeItem(item.id, { amount, reason: reason.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Bonificación aplicada", { description: `${item.description}: ahora ${formatMoney(res.newAmount, currency)}` });
      onOpenChange(false);
      router.refresh();
    });
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-400 flex items-center justify-center shrink-0">
              <BadgePercent size={16} />
            </span>
            Bonificar
          </DialogTitle>
          <DialogDescription>
            {item.description} · {chargeLabel}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-3 gap-px rounded-lg border bg-border overflow-hidden text-center">
          {[
            { k: "Importe", v: item.amount },
            { k: "Cobrado", v: item.paid },
            { k: "Saldo", v: item.outstanding },
          ].map((x) => (
            <div key={x.k} className="bg-card px-2 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.k}</dt>
              <dd className="text-sm font-semibold tabular-nums mt-0.5">{formatMoney(x.v, currency)}</dd>
            </div>
          ))}
        </dl>
        {item.kind === "punitorio" && (
          <p className="text-[11px] text-muted-foreground">
            Para perdonar los intereses de un pago también podés usar &quot;Condonar intereses&quot; al registrar el cobro.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="disc-amount">Cuánto se bonifica ({currency})</Label>
          <Input id="disc-amount" type="text" inputMode="decimal" placeholder="0,00" className="h-10 tabular-nums" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => setAmountText(q.value.toLocaleString("es-AR", { maximumFractionDigits: 2 }))}
                className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 min-h-7"
              >
                {q.label}: {formatMoney(q.value, currency)}
              </button>
            ))}
          </div>
          {after != null && amount != null && amount > 0 && amount <= item.outstanding + 0.004 && (
            <p className="text-xs text-muted-foreground">
              El concepto queda en <span className="font-medium text-foreground tabular-nums">{formatMoney(after, currency)}</span>.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="disc-reason">Motivo</Label>
          <Input id="disc-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ej: arreglo del calefón a cuenta del propietario" />
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Spinner /> : <BadgePercent size={14} />} Bonificar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
