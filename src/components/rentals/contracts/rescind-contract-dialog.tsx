"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, DoorOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney, parseAmountInput } from "@/lib/format";
import { EARLY_TERMINATION_LABEL } from "@/lib/rentals/labels";
import { addDays, minYmd } from "@/lib/rentals/ymd";
import type { RentalEarlyTerminationRule } from "@/lib/types/database";
import { previewTermination, rescindRentalContract } from "@/lib/actions/rentals-contracts";
import { editableNumber } from "./wizard-state";

/**
 * Rescisión anticipada: el inquilino avisa que se va antes. Calcula la
 * indemnización según lo que dice el contrato (art. 1221 vigente: 10 % del
 * alquiler que faltaba; Ley 27.551: 1,5 o 1 mes) y permite cargarla como
 * cargo de salida.
 */

type Preview = { amount: number; explanation: string; warning: string | null; remainingMonths: number; currentRent: number };

export function RescindContractDialog({
  contractId,
  open,
  onOpenChange,
  today,
  endDate,
  currency,
  rule: contractRule,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  endDate: string;
  currency: string;
  rule: RentalEarlyTerminationRule;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noticeDate, setNoticeDate] = useState(today);
  // Vencido y en continuación, el fin ya pasó: el default no puede quedar antes del aviso.
  const [moveOutDate, setMoveOutDate] = useState(endDate > today ? minYmd(addDays(today, 30), endDate) : addDays(today, 30));
  const [rule, setRule] = useState<RentalEarlyTerminationRule>(contractRule);
  const [agreed, setAgreed] = useState("");
  const [reason, setReason] = useState("");
  const [penalty, setPenalty] = useState("");
  const [charge, setCharge] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    if (!open || !noticeDate || !moveOutDate) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await previewTermination(contractId, {
        noticeDate,
        moveOutDate,
        rule,
        agreedAmount: rule === "pactada" ? parseAmountInput(agreed) : null,
      });
      if (cancelled) return;
      if (!res.ok) {
        setPreviewError(res.error);
        return;
      }
      setPreviewError(null);
      setPreview(res);
      if (!touched.current) setPenalty(editableNumber(res.amount));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, contractId, noticeDate, moveOutDate, rule, agreed]);

  const penaltyAmount = penalty.trim() ? parseAmountInput(penalty) : 0;

  function submit() {
    if (penaltyAmount == null || penaltyAmount < 0) {
      toast.error("Revisá la indemnización", { description: "Escribila así: 120.000 (o dejala en 0)." });
      return;
    }
    if (moveOutDate < noticeDate) {
      toast.error("Revisá las fechas", { description: "La desocupación no puede ser antes del aviso." });
      return;
    }
    startTransition(async () => {
      const res = await rescindRentalContract(contractId, {
        noticeDate,
        moveOutDate,
        reason: reason.trim() || "Rescisión anticipada del inquilino",
        penaltyAmount,
        chargePenalty: charge && penaltyAmount > 0,
      });
      if (!res.ok) {
        toast.error("No se pudo rescindir", { description: res.error });
        return;
      }
      const penaltyText = charge && penaltyAmount > 0 ? ` Se cargó la indemnización de ${formatMoney(penaltyAmount, currency)} en su cuenta.` : "";
      if (res.closesOn) {
        toast.success("Rescisión registrada", {
          description: `Sigue vigente, y se le sigue cobrando el alquiler, hasta el ${formatDate(res.closesOn)}. Ese día se cierra solo.${penaltyText}`,
        });
      } else {
        toast.success("Contrato rescindido", {
          description: penaltyText.trim() || "Los cargos posteriores a la desocupación se anularon.",
        });
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <DoorOpen size={16} />
            </span>
            Rescindir contrato
          </DialogTitle>
          <DialogDescription>El inquilino se va antes de que termine. Calculamos la indemnización con lo que dice el contrato.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-aviso">Avisó el</Label>
              <Input id="res-aviso" type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-sale">Desocupa el</Label>
              <Input id="res-sale" type="date" value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} className="h-10" />
            </div>
          </div>
          {moveOutDate > today && (
            <p className="text-xs text-muted-foreground -mt-2">
              Hasta que desocupe, el contrato sigue vigente y se le siguen cobrando los alquileres (art. 1221 CCyC). Ese día se cierra solo.
            </p>
          )}
          <div className="space-y-1.5">
            <Label>Indemnización según</Label>
            <Select value={rule} onValueChange={(v) => setRule(v as RentalEarlyTerminationRule)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EARLY_TERMINATION_LABEL) as RentalEarlyTerminationRule[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {EARLY_TERMINATION_LABEL[k]}
                    {k === contractRule ? " · la del contrato" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {rule === "pactada" && (
            <div className="space-y-1.5">
              <Label htmlFor="res-pactada">Monto que dice el contrato ({currency})</Label>
              <Input id="res-pactada" inputMode="decimal" value={agreed} onChange={(e) => setAgreed(e.target.value)} placeholder="0,00" className="h-10 tabular-nums" />
            </div>
          )}
          <div className="rounded-xl border bg-muted/30 p-3.5 space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Indemnización calculada</p>
            {previewError ? (
              <p className="text-sm text-rose-600">{previewError}</p>
            ) : preview ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">{formatMoney(preview.amount, currency)}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {preview.explanation} Alquiler vigente: {formatMoney(preview.currentRent, currency)}.
                </p>
                {preview.warning && (
                  <p className="text-xs text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {preview.warning}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Calculando…
              </p>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_10rem] items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-monto">Indemnización a cobrar</Label>
              <p className="text-[11px] text-muted-foreground">Podés corregirla si acordaron otra cosa.</p>
            </div>
            <Input
              id="res-monto"
              inputMode="decimal"
              value={penalty}
              onChange={(e) => {
                touched.current = true;
                setPenalty(e.target.value);
              }}
              className="h-10 text-right tabular-nums"
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Checkbox checked={charge} onCheckedChange={(v) => setCharge(v === true)} className="mt-0.5" />
            <span className="text-sm">
              Cargarla en la cuenta del inquilino
              <span className="block text-xs text-muted-foreground">Queda como cargo de salida, a favor del propietario.</span>
            </span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="res-motivo">Motivo (opcional)</Label>
            <Input id="res-motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Se muda por trabajo, compra de vivienda…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />}
            Rescindir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
