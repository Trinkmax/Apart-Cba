"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteSettlement } from "@/lib/actions/settlements";

/**
 * Botón de borrado definitivo de una liquidación, para la lista. Una
 * liquidación pagada no se puede borrar (dejaría huérfano el egreso en Caja):
 * el botón queda deshabilitado con la explicación.
 */
export function SettlementDeleteButton({
  id,
  ownerName,
  period,
  paid,
}: {
  id: string;
  ownerName: string;
  period: string;
  paid: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDelete() {
    start(async () => {
      try {
        await deleteSettlement(id);
        toast.success("Liquidación eliminada");
        router.refresh();
      } catch (e) {
        toast.error("No se pudo eliminar", {
          description: (e as Error).message,
        });
      }
    });
  }

  if (paid) {
    return (
      <span
        title="No se puede eliminar una liquidación pagada"
        className="inline-flex"
      >
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="size-8 text-muted-foreground/30"
          aria-label="No se puede eliminar una liquidación pagada"
        >
          <Trash2 size={15} />
        </Button>
      </span>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          className="size-8 text-muted-foreground hover:text-rose-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
          aria-label={`Eliminar liquidación de ${ownerName}`}
        >
          <Trash2 size={15} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar la liquidación?</AlertDialogTitle>
          <AlertDialogDescription>
            {ownerName} · {period}. Se borra de forma permanente junto con su
            detalle y su historial. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={pending}
            className="bg-rose-600 hover:bg-rose-700"
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
