"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Ban, Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMoney } from "@/lib/format";
import { sendStatementEmail, voidStatement } from "@/lib/actions/rentals-statements";

/** Diálogos de la rendición: mandar por mail y anular. */

export function SendStatementDialog({
  open,
  onOpenChange,
  statementId,
  number,
  defaultTo,
  isDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementId: string;
  number: string;
  defaultTo: string | null;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    if (!to.trim()) return setError("Escribí el mail del propietario.");
    start(async () => {
      const res = await sendStatementEmail(statementId, to.trim());
      if (!res.ok) {
        setError(res.error);
        toast.error("No se pudo mandar la rendición", { description: res.error });
        return;
      }
      toast.success("Rendición enviada", { description: `Le llegó a ${res.sentTo} con el PDF adjunto y el link.` });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 dark:text-violet-400">
              <Mail size={16} />
            </span>
            Enviar la rendición N° {number}
          </DialogTitle>
          <DialogDescription>
            Le mandamos un mail con el resumen, el PDF adjunto y el link para verla desde el celular.
            {isDraft ? " Al enviarla queda emitida." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="send-st-to" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Mail del propietario
          </label>
          <Input
            id="send-st-to"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setError(null);
            }}
            placeholder="propietario@mail.com"
            className="h-10"
          />
          {!defaultTo && <p className="text-[11px] text-muted-foreground">El propietario no tiene mail cargado: escribilo acá (no se guarda en su ficha).</p>}
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={send} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoidStatementDialog({
  open,
  onOpenChange,
  statementId,
  number,
  paid,
  net,
  currency,
  paymentsCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementId: string;
  number: string;
  paid: boolean;
  net: number;
  currency: string;
  paymentsCount: number;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [deletePayments, setDeletePayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    if (reason.trim().length < 3) return setError("Contá brevemente por qué se anula.");
    if (paid && !deletePayments) return setError("Para anular una rendición pagada hay que borrar también sus egresos de Caja.");
    start(async () => {
      const res = await voidStatement(statementId, { reason: reason.trim(), deletePayments: paid && deletePayments });
      if (!res.ok) {
        setError(res.error);
        toast.error("No se pudo anular", { description: res.error });
        return;
      }
      toast.success(`Rendición N° ${number} anulada`, { description: "Sus cobros y gastos volvieron a quedar para rendir." });
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
              <Ban size={16} />
            </span>
            Anular la rendición N° {number}
          </DialogTitle>
          <DialogDescription>Los cobros, honorarios y gastos que incluía vuelven a quedar “para rendir”, así podés generarla de nuevo bien.</DialogDescription>
        </DialogHeader>
        {paid && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-200">
            <p className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Ya figura pagada: se registró {paymentsCount === 1 ? "un egreso" : `${paymentsCount} egresos`} en Caja por {formatMoney(net, currency)}.
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <Checkbox checked={deletePayments} onCheckedChange={(v) => setDeletePayments(v === true)} className="mt-0.5" />
              <span>Borrar también esos egresos de Caja (hacelo sólo si la transferencia no se hizo o se devolvió).</span>
            </label>
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="void-st-reason" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Motivo
          </label>
          <Textarea id="void-st-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={400} placeholder="Ej.: faltaba un gasto del propietario" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Queda para el equipo: en el link del propietario sólo figura que se anuló. Anular no apaga el link; si llegó a quien no correspondía, dalo de baja
            después desde el botón ⋯.
          </p>
        </div>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Volver
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Anular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
