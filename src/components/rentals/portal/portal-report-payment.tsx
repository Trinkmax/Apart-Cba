"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, HandCoins, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoneyEditable } from "@/components/bookings/money-input";
import { formatMoney, parseAmountInput } from "@/lib/format";
import { reportTenantPayment } from "@/lib/actions/rentals-portal";
import { ProofFilePicker } from "@/components/rentals/proofs/proof-file-picker";
import type { PreparedProofFile } from "@/components/rentals/proofs/prepare-file";
import { readableTextOn } from "./portal-helpers";

/**
 * "Ya pagué": el inquilino avisa la transferencia con monto, fecha y, mejor,
 * el comprobante. No es un cobro: la inmobiliaria lo verifica y le manda el
 * recibo. Muestra una confirmación clara al terminar.
 */
export function PortalReportPayment({
  token,
  currency,
  suggestedAmount,
  today,
  brandColor,
}: {
  token: string;
  currency: string;
  suggestedAmount: number | null;
  today: string;
  brandColor: string;
}) {
  const router = useRouter();
  const fg = readableTextOn(brandColor);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [amount, setAmount] = useState(() => formatMoneyEditable(suggestedAmount ? Math.round(suggestedAmount * 100) / 100 : null));
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<PreparedProofFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ amount?: string; paidOn?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next && done != null) {
      setDone(null);
      setNote("");
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      setFile(null);
      router.refresh();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseAmountInput(amount);
    if (n == null || n <= 0) {
      setErrors({ amount: "Indicá el monto que pagaste (por ejemplo 543.500)." });
      return;
    }
    if (!paidOn || paidOn > today) {
      setErrors({ paidOn: "La fecha no puede ser futura." });
      return;
    }
    const fd = new FormData();
    fd.set("token", token);
    fd.set("amount", amount.trim());
    fd.set("paidOn", paidOn);
    fd.set("note", note.trim());
    if (file) fd.set("receipt", file.file, file.file.name);
    setErrors({});
    startTransition(async () => {
      const res = await reportTenantPayment(fd);
      if (!res.ok) {
        if (res.field === "receipt") setFileError(res.error);
        else if (res.field === "amount" || res.field === "paidOn") setErrors({ [res.field]: res.error });
        else setErrors({ form: res.error });
        return;
      }
      setDone(n);
    });
  }

  return (
    <>
      <Button
        type="button"
        className="h-12 w-full gap-2 text-base font-semibold shadow-sm"
        style={{ backgroundColor: brandColor, color: fg }}
        onClick={() => setOpen(true)}
      >
        <HandCoins size={18} /> Ya pagué: avisar y subir comprobante
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          {done != null ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                <CircleCheck size={30} />
              </span>
              <DialogTitle className="text-lg">¡Gracias! Recibimos tu aviso</DialogTitle>
              <DialogDescription className="max-w-xs">
                Informaste un pago de <strong className="text-foreground">{formatMoney(done, currency)}</strong>. Lo verificamos con el
                banco y te mandamos el recibo. Mientras tanto lo vas a ver acá como «en revisión».
              </DialogDescription>
              <Button className="mt-2 h-11 w-full" style={{ backgroundColor: brandColor, color: fg }} onClick={() => close(false)}>
                Listo
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Avisar un pago</DialogTitle>
                <DialogDescription>Con el comprobante lo podemos verificar mucho más rápido.</DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-[1fr_auto] items-start gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="report-amount">Monto ({currency})</Label>
                    <Input
                      id="report-amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-11 text-lg tabular-nums"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-invalid={!!errors.amount}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report-date">Fecha</Label>
                    <Input id="report-date" type="date" className="h-11" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-invalid={!!errors.paidOn} />
                  </div>
                </div>
                {(errors.amount || errors.paidOn) && <p className="-mt-2 text-xs font-medium text-rose-700">{errors.amount ?? errors.paidOn}</p>}
                <div className="space-y-1.5">
                  <Label>Comprobante de la transferencia</Label>
                  <ProofFilePicker value={file} onChange={setFile} error={fileError} onError={setFileError} disabled={pending} label="Elegir captura o PDF" hint="La captura del home banking sirve (hasta 4 MB)" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-note">
                    Nota <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <Textarea id="report-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: la hice desde la cuenta de mi pareja." />
                </div>
                {errors.form && <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{errors.form}</p>}
                <Button type="submit" disabled={pending} className="h-12 w-full gap-2 text-base" style={{ backgroundColor: brandColor, color: fg }}>
                  {pending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {pending ? "Enviando aviso…" : "Enviar aviso"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">Tu aviso no confirma el pago por sí solo: lo verificamos y te mandamos el recibo.</p>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
