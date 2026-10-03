"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CalendarCheck2, Loader2, RefreshCcw, Trash2, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatMoney, parseAmountInput } from "@/lib/format";
import { addDays } from "@/lib/rentals/ymd";
import { continuationGap } from "@/lib/rentals/exit";
import { formatContractNumber } from "@/lib/rentals/labels";
import { REGIME_IN_FORCE } from "@/lib/rentals/renewal";
import { contractEndDate } from "@/lib/rentals/schedule";
import type { RentalLegalRegime } from "@/lib/types/database";
import { changeRentalContractExit, deleteDraftRentalContract, finalizeRentalContract, renewRentalContract } from "@/lib/actions/rentals-contracts";
import { editableNumber } from "./wizard-state";

type DialogProps = { contractId: string; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Contrato vencido que no cobra la continuación y la salida queda después del
 * fin: los meses del medio no se están facturando. Se avisa y se ofrece
 * cobrarlos en el mismo paso (art. 1218). También lo usa el diálogo de rescisión.
 */
export function ContinuationGapNotice({
  endDate,
  checked,
  onCheckedChange,
  until,
}: {
  endDate: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** "hasta la entrega", "hasta que desocupe"… */
  until: string;
}) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 space-y-2">
      <p className="text-xs text-amber-900 dark:text-amber-100">Venció el {formatDate(endDate)} y los meses desde entonces no se están cobrando.</p>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" />
        <span className="text-sm">
          Cobrar los meses {until}
          <span className="block text-xs text-muted-foreground">Al último alquiler y sin ajustes nuevos (continuación, art. 1218 CCyC).</span>
        </span>
      </label>
    </div>
  );
}

export function FinalizeContractDialog({
  contractId,
  open,
  onOpenChange,
  endDate,
  today,
  scheduledExit = null,
  rescission = false,
  continuationBilling = false,
}: DialogProps & {
  endDate: string;
  today: string;
  /** Salida ya registrada (rescisión notificada o entrega programada): sólo se registra la entrega real. */
  scheduledExit?: string | null;
  rescission?: boolean;
  /** Ya cobra los meses de continuación (art. 1218). */
  continuationBilling?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Por defecto hoy: es el día en que entrega las llaves. Con el contrato vencido,
  // la fecha de fin original dejaría sin cobrar los meses que siguió adentro.
  const [endedOn, setEndedOn] = useState(today);
  const [reason, setReason] = useState(endDate <= today && !scheduledExit ? "Fin del contrato" : "");
  // Vencido sin cobrar la continuación: por defecto se cobran los meses hasta la entrega (sigue debiéndolos).
  const [billContinuation, setBillContinuation] = useState(true);
  const handover = Boolean(scheduledExit);
  const future = !handover && endedOn > today;
  const gap = Boolean(endedOn) && continuationGap({ status: "vigente", end_date: endDate, continuation_billing: continuationBilling }, endedOn, today);

  function submit() {
    startTransition(async () => {
      const res = await finalizeRentalContract(contractId, { endedOn, reason: reason.trim() || null, continuationBilling: gap && billContinuation });
      if (!res.ok) {
        toast.error(handover ? "No se pudo registrar la entrega" : "No se pudo finalizar", { description: res.error });
        return;
      }
      if (res.closesOn) {
        toast.success("Entrega programada", {
          description: `Sigue vigente, y se le sigue cobrando, hasta el ${formatDate(res.closesOn)}. Ese día se finaliza solo.`,
        });
      } else {
        toast.success(handover && rescission ? "Contrato rescindido" : "Contrato finalizado", {
          description: "No se van a generar más cargos. Si tiene depósito, cerralo desde el aviso de la ficha: devolverlo, aplicarlo a lo que quedó debiendo o pasarlo a la renovación.",
        });
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <CalendarCheck2 size={16} />
            </span>
            {handover ? "Registrar entrega de llaves" : "Finalizar contrato"}
          </DialogTitle>
          <DialogDescription>
            {handover
              ? `Tenía la salida registrada para el ${formatDate(scheduledExit ?? today)}. Si entregó las llaves antes, poné la fecha real: la cuenta se cierra en el momento.`
              : "Para cuando el inquilino entrega las llaves. Los cargos de meses posteriores se anulan (el saldo a favor que tenían imputado vuelve al inquilino); lo que ya debe sigue en su cuenta."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fin-fecha">{handover ? "Entregó las llaves el" : "Fecha de entrega de llaves"}</Label>
            <Input id="fin-fecha" type="date" value={endedOn} max={handover ? today : undefined} onChange={(e) => setEndedOn(e.target.value)} className="h-10" />
            {!handover && (
              <p className="text-[11px] text-muted-foreground">
                El contrato terminaba el {formatDate(endDate)}.
                {endDate < today && endedOn !== endDate && (
                  <>
                    {" "}
                    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setEndedOn(endDate)}>
                      Se fue ese día
                    </button>
                  </>
                )}
              </p>
            )}
            {future && (
              <p className="text-xs rounded-lg bg-violet-500/[0.08] text-violet-900 dark:text-violet-200 px-3 py-2">
                {gap && !billContinuation
                  ? "Es una fecha futura: el contrato sigue vigente hasta ese día, pero sin cobrar los meses desde el vencimiento. Después se finaliza solo."
                  : "Es una fecha futura: el contrato sigue vigente, y se le sigue cobrando, hasta ese día. Después se finaliza solo."}
              </p>
            )}
          </div>
          {gap && (
            <ContinuationGapNotice endDate={endDate} checked={billContinuation} onCheckedChange={setBillContinuation} until="hasta la entrega de llaves" />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fin-motivo">Motivo (opcional)</Label>
            <Input id="fin-motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fin del contrato, entrega de llaves…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !endedOn} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck2 size={14} />}
            {handover ? "Registrar entrega" : future ? "Programar entrega" : "Finalizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Correr o anular una salida registrada: el inquilino pide quedarse más, se va
 * antes de lo avisado (pero todavía no entregó) o directamente se queda. Sin
 * esto el contrato se cerraba igual el día anotado.
 */
export function ChangeExitDialog({
  contractId,
  open,
  onOpenChange,
  today,
  scheduledExit,
  rescission,
  penalty,
  currency,
  endDate,
  continuationBilling,
}: DialogProps & {
  today: string;
  scheduledExit: string;
  rescission: boolean;
  penalty: number | null;
  currency: string;
  endDate: string;
  continuationBilling: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"move" | "withdraw">("move");
  const [newDate, setNewDate] = useState(scheduledExit > today ? scheduledExit : addDays(today, 1));
  const [billContinuation, setBillContinuation] = useState(true);
  const withdraw = mode === "withdraw";
  const target = withdraw ? null : newDate;
  const gap = continuationGap({ status: "vigente", end_date: endDate, continuation_billing: continuationBilling }, target, today);
  const dateOk = withdraw || (Boolean(newDate) && newDate > today && newDate !== scheduledExit);
  const what = rescission ? "la rescisión" : "la entrega";

  function submit() {
    startTransition(async () => {
      const res = await changeRentalContractExit(contractId, { expected: scheduledExit, newDate: target, continuationBilling: gap && billContinuation });
      if (!res.ok) {
        toast.error("No se pudo cambiar la salida", { description: res.error });
        return;
      }
      toast.success(withdraw ? (rescission ? "Rescisión anulada" : "Entrega anulada") : "Salida cambiada", {
        description: withdraw
          ? "El contrato sigue vigente y se vuelven a facturar los meses siguientes."
          : `Sigue vigente, y se le sigue cobrando, hasta el ${formatDate(res.closesOn ?? newDate)}. Ese día se cierra solo.`,
      });
      if (res.notice) toast.warning(res.notice, { duration: 12_000 });
      onOpenChange(false);
      router.refresh();
    });
  }

  const option = (key: "move" | "withdraw", title: string, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      aria-pressed={mode === key}
      className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${mode === key ? "border-primary bg-primary/[0.06]" : "hover:bg-accent/40"}`}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center">
              <CalendarClock size={16} />
            </span>
            Cambiar la salida
          </DialogTitle>
          <DialogDescription>
            {rescission ? `Notificó la rescisión y desocupa el ${formatDate(scheduledExit)}.` : `Entrega las llaves el ${formatDate(scheduledExit)}.`} Ese día el contrato se
            cierra solo: si cambió la fecha o se queda, corregilo acá.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {option("move", "Cambiar la fecha", "Se queda más, o se va antes.")}
            {option("withdraw", rescission ? "Anular la rescisión" : "Anular la entrega", "Se queda: sigue como antes.")}
          </div>
          {withdraw ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              El contrato sigue{" "}
              {endDate >= today ? `hasta su fin (${formatDate(endDate)})` : `como vencido (terminó el ${formatDate(endDate)})`} y se vuelven a facturar los meses siguientes.
              {rescission && penalty
                ? ` La indemnización de ${formatMoney(penalty, currency)} se anula si no tiene cobros; si ya se cobró, queda en la cuenta y te avisamos.`
                : ""}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="salida-fecha">{rescission ? "Desocupa el" : "Entrega las llaves el"}</Label>
              <Input id="salida-fecha" type="date" value={newDate} min={addDays(today, 1)} onChange={(e) => setNewDate(e.target.value)} className="h-10" />
              <p className="text-[11px] text-muted-foreground">
                {newDate > scheduledExit
                  ? "Se vuelven a facturar los meses hasta la fecha nueva."
                  : newDate && newDate < scheduledExit
                    ? "Se anulan los cargos de los meses posteriores a la fecha nueva."
                    : `Si ya entregó las llaves, cerrá ${what} con «Registrar entrega de llaves».`}
                {rescission && penalty ? " La indemnización no se recalcula: si cambia, corregila desde la cuenta." : ""}
              </p>
            </div>
          )}
          {gap && (
            <ContinuationGapNotice
              endDate={endDate}
              checked={billContinuation}
              onCheckedChange={setBillContinuation}
              until={withdraw ? "desde el vencimiento mientras siga adentro" : "hasta la fecha nueva"}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !dateOk}
            className={withdraw ? "gap-2 bg-rose-600 hover:bg-rose-700 text-white" : "gap-2"}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : withdraw ? <Undo2 size={14} /> : <CalendarClock size={14} />}
            {withdraw ? (rescission ? "Anular la rescisión" : "Anular la entrega") : "Guardar la fecha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenewContractDialog({
  contractId,
  open,
  onOpenChange,
  endDate,
  durationMonths,
  rentInForce,
  currency,
  legalRegime,
  guarantors,
}: DialogProps & {
  endDate: string;
  durationMonths: number;
  rentInForce: number;
  currency: string;
  legalRegime: RentalLegalRegime;
  /** Cuántos garantes tiene: en la renovación cada uno tiene que firmar de nuevo (art. 1225 CCyC). */
  guarantors: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(addDays(endDate, 1));
  const [months, setMonths] = useState(String(durationMonths));
  const [rent, setRent] = useState(editableNumber(rentInForce));
  const parsedRent = parseAmountInput(rent);
  const parsedMonths = /^\d{1,3}$/.test(months.trim()) ? Number(months) : null;

  function submit() {
    if (parsedRent == null || parsedRent <= 0) {
      toast.error("Revisá el alquiler", { description: "Escribilo así: 650.000" });
      return;
    }
    if (!parsedMonths || parsedMonths < 1 || parsedMonths > 120) {
      toast.error("Revisá el plazo", { description: "Va de 1 a 120 meses." });
      return;
    }
    startTransition(async () => {
      const res = await renewRentalContract(contractId, { startDate, durationMonths: parsedMonths, initialRent: parsedRent });
      if (!res.ok) {
        toast.error("No se pudo armar la renovación", { description: res.error });
        return;
      }
      // Lo que se puso como en un contrato nuevo, para que nadie lo dé por heredado.
      const consentNote = res.guarantors
        ? ` ${res.guarantors === 1 ? "El garante tiene" : "Los garantes tienen"} que firmar la renovación: cargá la fecha en «Inquilino y garantes».`
        : "";
      toast.success(`Renovación ${formatContractNumber(res.number)} lista para revisar`, {
        description: `${res.changes.length ? res.changes.join(" ") : "Es un borrador: revisá las condiciones y activalo cuando esté firmado."}${consentNote}`,
        duration: res.changes.length || res.guarantors ? 12_000 : undefined,
      });
      onOpenChange(false);
      router.push(`/dashboard/alquileres/contratos/${res.contractId}/editar`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-400 flex items-center justify-center">
              <RefreshCcw size={16} />
            </span>
            Renovar contrato
          </DialogTitle>
          <DialogDescription>
            Se arma un borrador nuevo con las mismas condiciones económicas y personas. Lo legal va como en un contrato que se firma hoy: régimen vigente, sellado pendiente y sin
            RELI.
            {guarantors > 0 && " Los garantes tienen que firmar la renovación (art. 1225 CCyC): sin su conformidad no se activa."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ren-inicio">Empieza el</Label>
              <Input id="ren-inicio" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ren-meses">Plazo (meses)</Label>
              <Input id="ren-meses" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} className="h-10 tabular-nums" />
            </div>
          </div>
          {legalRegime !== REGIME_IN_FORCE && (
            <p className="text-[11px] text-muted-foreground -mt-1">El plazo ya no lo fija la ley: es el que pacten (DNU 70/2023).</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ren-alquiler">Alquiler inicial ({currency})</Label>
            <Input id="ren-alquiler" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} className="h-10 text-lg tabular-nums" />
            <p className="text-[11px] text-muted-foreground">Hoy paga {formatMoney(rentInForce, currency)}. Ajustalo a lo que acordaron.</p>
          </div>
          {parsedMonths && startDate && (
            <p className="text-xs text-muted-foreground rounded-lg bg-muted/40 px-3 py-2">
              Va del {formatDate(startDate)} al {formatDate(contractEndDate(startDate, parsedMonths))}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Armar renovación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDraftDialog({ contractId, open, onOpenChange, label }: DialogProps & { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function submit() {
    startTransition(async () => {
      const res = await deleteDraftRentalContract(contractId);
      if (!res.ok) {
        toast.error("No se pudo borrar", { description: res.error });
        return;
      }
      toast.success("Borrador eliminado");
      onOpenChange(false);
      router.push("/dashboard/alquileres/contratos");
    });
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-rose-600" /> ¿Borrar el borrador {label}?
          </AlertDialogTitle>
          <AlertDialogDescription>Se borra el contrato y sus datos. La propiedad y las personas quedan como están.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              submit();
            }}
            disabled={pending}
            className="bg-rose-600 hover:bg-rose-700 text-white gap-2"
          >
            {pending && <Loader2 size={14} className="animate-spin" />} Borrar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
