"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck2, Loader2, RefreshCcw, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatMoney, parseAmountInput } from "@/lib/format";
import { addDays } from "@/lib/rentals/ymd";
import { contractEndDate } from "@/lib/rentals/schedule";
import { deleteDraftRentalContract, finalizeRentalContract, renewRentalContract } from "@/lib/actions/rentals-contracts";
import { editableNumber } from "./wizard-state";

type DialogProps = { contractId: string; open: boolean; onOpenChange: (open: boolean) => void };

export function FinalizeContractDialog({
  contractId,
  open,
  onOpenChange,
  endDate,
  today,
  scheduledExit = null,
  rescission = false,
}: DialogProps & {
  endDate: string;
  today: string;
  /** Salida ya registrada (rescisión notificada o entrega programada): sólo se registra la entrega real. */
  scheduledExit?: string | null;
  rescission?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Por defecto hoy: es el día en que entrega las llaves. Con el contrato vencido,
  // la fecha de fin original dejaría sin cobrar los meses que siguió adentro.
  const [endedOn, setEndedOn] = useState(today);
  const [reason, setReason] = useState(endDate <= today && !scheduledExit ? "Fin del contrato" : "");
  const handover = Boolean(scheduledExit);
  const future = !handover && endedOn > today;

  function submit() {
    startTransition(async () => {
      const res = await finalizeRentalContract(contractId, { endedOn, reason: reason.trim() || null });
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
          description: "No se van a generar más cargos. Si hay depósito, queda para devolver.",
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
                Es una fecha futura: el contrato sigue vigente, y se le sigue cobrando, hasta ese día. Después se finaliza solo.
              </p>
            )}
          </div>
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

export function RenewContractDialog({
  contractId,
  open,
  onOpenChange,
  endDate,
  durationMonths,
  rentInForce,
  currency,
}: DialogProps & { endDate: string; durationMonths: number; rentInForce: number; currency: string }) {
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
      toast.success("Renovación lista para revisar", { description: "Es un borrador: revisá las condiciones y activalo cuando esté firmado." });
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
            Se arma un contrato nuevo en borrador con las mismas condiciones y personas. Los garantes tienen que volver a dar su conformidad (art. 1225 CCyC).
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
