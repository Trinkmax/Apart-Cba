"use client";

import { useTransition, useState } from "react";
import { Loader2, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteMovement, type MovementDetail } from "@/lib/actions/cash";

interface Props {
  movement: MovementDetail;
  onDeleted?: () => void;
  trigger: React.ReactNode;
}

export function MovementDeleteAlert({ movement, onDeleted, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [actorName, setActorName] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const isTransfer = movement.category === "transfer";
  const isLockedSettlement = movement.linked_settlement?.is_locked ?? false;
  const actorOk = actorName.trim().length >= 2;

  function copy() {
    if (isLockedSettlement) {
      return {
        title: "Movimiento bloqueado",
        body: `Este movimiento está vinculado a la liquidación ${String(movement.linked_settlement!.period_month).padStart(2, "0")}/${movement.linked_settlement!.period_year} en estado "${movement.linked_settlement!.status}". Anulá la liquidación primero para poder eliminarlo.`,
        action: null as null | string,
      };
    }
    if (isTransfer) {
      return {
        title: "Eliminar transferencia completa",
        body: `Esto eliminará los DOS movimientos vinculados (entrada y salida). Esta acción no se puede deshacer.`,
        action: "Eliminar transferencia",
      };
    }
    if (movement.linked_schedule) {
      const s = movement.linked_schedule;
      return {
        title: `Eliminar cobro de cuota ${s.sequence_number}/${s.total_count}`,
        body: `La cuota volverá a estado "pending" o "partial" según el saldo restante, y se restará el importe del paid_amount de la reserva.`,
        action: "Eliminar cobro",
      };
    }
    if (movement.linked_booking) {
      return {
        title: "Eliminar pago de reserva",
        body: `paid_amount de la reserva ${movement.linked_booking.id.slice(0, 8)} bajará en este importe. Esta acción no se puede deshacer.`,
        action: "Eliminar pago",
      };
    }
    return {
      title: "Eliminar movimiento",
      body: "Esta acción no se puede deshacer.",
      action: "Eliminar",
    };
  }

  const c = copy();

  function handleDelete() {
    if (!actorOk) {
      toast.error("Indicá tu nombre antes de eliminar");
      return;
    }
    startTransition(async () => {
      try {
        const res = await deleteMovement({
          id: movement.id,
          force_transfer: isTransfer,
          actor_name: actorName.trim(),
        });
        const effects = (res.side_effects ?? []).filter((e) => e !== "Movimiento eliminado");
        toast.success("Movimiento eliminado", {
          description: effects.length ? effects.join(" · ") : undefined,
        });
        setOpen(false);
        setActorName("");
        onDeleted?.();
        router.refresh();
      } catch (e) {
        toast.error("No se pudo eliminar", { description: (e as Error).message });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <span onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{trigger}</span>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isLockedSettlement ? <Lock size={16} /> : <Trash2 size={16} className="text-rose-600" />}
            {c.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{c.body}</AlertDialogDescription>
        </AlertDialogHeader>

        {!isLockedSettlement && (
          <div className="space-y-1.5 rounded-xl border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40 p-3">
            <Label className="text-amber-900 dark:text-amber-200 text-[11px] uppercase tracking-wider font-semibold">
              ¿Quién está eliminando este movimiento? *
            </Label>
            <Input
              autoFocus
              required
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              placeholder="Nombre del administrador"
              className="h-9 bg-background"
            />
            <p className="text-[10px] text-amber-800/80 dark:text-amber-200/80">
              Queda registrado en el historial junto con la fecha y hora.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setActorName("")}>Cancelar</AlertDialogCancel>
          {c.action && !isLockedSettlement && (
            <Button
              type="button"
              onClick={handleDelete}
              disabled={isPending || !actorOk}
              className="bg-rose-600 hover:bg-rose-600/90 text-white focus-visible:ring-rose-600/50 gap-1.5"
            >
              {isPending ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
              {c.action}
            </Button>
          )}
          {isLockedSettlement && movement.linked_settlement && (
            <Button asChild>
              <a href={`/dashboard/liquidaciones/${movement.linked_settlement.id}`}>
                Abrir liquidación
              </a>
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
