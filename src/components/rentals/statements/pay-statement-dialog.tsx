"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import { payStatement } from "@/lib/actions/rentals-statements";
import { validateSplits } from "./statement-model";
import { CopyButton } from "./copy-button";
import type { PayoutAccount } from "./types";

interface Row {
  key: number;
  accountId: string;
  amount: string;
}

function editable(n: number): string {
  return formatMoneyEditable(n).replace(".", ",");
}

/**
 * Registrar la transferencia al propietario. Se puede dividir en varias
 * cuentas (parte desde el banco, parte en efectivo): cada una genera su
 * egreso en Caja y la suma tiene que dar exactamente el neto.
 */
export function PayStatementDialog({
  open,
  onOpenChange,
  statementId,
  number,
  net,
  currency,
  accounts,
  today,
  owner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementId: string;
  number: string;
  net: number;
  currency: string;
  accounts: PayoutAccount[];
  today: string;
  owner: { full_name: string; cbu: string | null; alias_cbu: string | null; bank_name: string | null };
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => [{ key: 1, accountId: accounts[0]?.id ?? "", amount: editable(net) }]);
  const [paidAt, setPaidAt] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsed = rows.map((r) => ({ accountId: r.accountId, amount: parseAmountInput(r.amount) }));
  const check = validateSplits(parsed, net, currency);
  const assigned = check.total;
  const remaining = Math.round((net - assigned) * 100) / 100;
  const pct = net > 0 ? Math.min(100, Math.max(0, (assigned / net) * 100)) : 0;
  const usedIds = new Set(rows.map((r) => r.accountId));

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  }

  function addRow() {
    const free = accounts.find((a) => !usedIds.has(a.id));
    setRows((rs) => [...rs, { key: Math.max(...rs.map((r) => r.key)) + 1, accountId: free?.id ?? "", amount: remaining > 0 ? editable(remaining) : "" }]);
  }

  function confirm() {
    if (!check.ok) return setError(check.error);
    if (!paidAt || paidAt > today) return setError("La fecha del pago no es válida.");
    start(async () => {
      const res = await payStatement(statementId, {
        splits: parsed.map((p) => ({ accountId: p.accountId, amount: p.amount ?? 0 })),
        paidAt,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error("No se pudo registrar el pago", { description: res.error });
        return;
      }
      toast.success(`Rendición N° ${number} pagada`, { description: `${formatMoney(net, currency)} a ${owner.full_name}. Quedó el egreso en Caja.` });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Wallet size={16} />
            </span>
            Registrar pago al propietario
          </DialogTitle>
          <DialogDescription>
            Rendición N° {number} · neto {formatMoney(net, currency)}. Si lo pagaste desde más de una cuenta, dividilo.
          </DialogDescription>
        </DialogHeader>

        {(owner.cbu || owner.alias_cbu) && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Transferir a {owner.full_name}</div>
            {owner.alias_cbu && (
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs">Alias: {owner.alias_cbu}</span>
                <CopyButton value={owner.alias_cbu} label="Alias" className="size-7" />
              </div>
            )}
            {owner.cbu && (
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-xs">CBU: {owner.cbu}</span>
                <CopyButton value={owner.cbu} label="CBU" className="size-7" />
              </div>
            )}
          </div>
        )}

        {accounts.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No hay cuentas activas en {currency}. Creá una en Caja para registrar el pago.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.key} className="grid grid-cols-[1fr_8.5rem_auto] items-center gap-2">
                <Select value={r.accountId} onValueChange={(v) => update(r.key, { accountId: v })}>
                  <SelectTrigger className="h-10 w-full" aria-label={`Cuenta ${i + 1}`}>
                    <SelectValue placeholder="Cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id} disabled={a.id !== r.accountId && usedIds.has(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={r.amount}
                  onChange={(e) => update(r.key, { amount: e.target.value })}
                  className="h-10 tabular-nums text-right"
                  aria-label={`Importe cuenta ${i + 1}`}
                />
                {rows.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Quitar cuenta">
                    <Trash2 size={15} />
                  </Button>
                ) : (
                  <span className="size-10" />
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {rows.length < accounts.length ? (
                <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2" onClick={addRow}>
                  <Plus size={14} /> Dividir en otra cuenta
                </Button>
              ) : (
                <span />
              )}
              {remaining > 0.004 && rows.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const last = rows[rows.length - 1];
                    update(last.key, { amount: editable((parseAmountInput(last.amount) ?? 0) + remaining) });
                  }}
                >
                  Completar con lo que falta
                </Button>
              )}
            </div>
            <div className="space-y-1.5 rounded-lg border px-3 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Asignado {formatMoney(assigned, currency)} de {formatMoney(net, currency)}
                </span>
                {check.ok ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={13} /> Cierra justo
                  </span>
                ) : (
                  <span className={cn("font-medium tabular-nums", remaining > 0 ? "text-amber-700 dark:text-amber-300" : "text-rose-600 dark:text-rose-400")}>
                    {remaining > 0 ? `Faltan ${formatMoney(remaining, currency)}` : remaining < 0 ? `Sobran ${formatMoney(-remaining, currency)}` : ""}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-[width] duration-300", check.ok ? "bg-emerald-500" : remaining < 0 ? "bg-rose-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="pay-st-date" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Fecha de la transferencia
              </label>
              <Input id="pay-st-date" type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} className="h-10 w-auto" />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={pending || accounts.length === 0} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />} Registrar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
