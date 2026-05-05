"use client";

import { useState, useTransition } from "react";
import { MoreVertical, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { archiveUnit } from "@/lib/actions/units";

interface UnitDeleteActionProps {
  unitId: string;
  unitCode: string;
  unitName: string;
}

export function UnitDeleteAction({
  unitId,
  unitCode,
  unitName,
}: UnitDeleteActionProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await archiveUnit(unitId);
        toast.success(`Unidad ${unitCode} eliminada`, {
          description: "Se conserva la historia de reservas y liquidaciones.",
        });
        setConfirmOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo eliminar la unidad", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Acciones para ${unitCode}`}
          >
            <MoreVertical size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 size={14} /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar unidad {unitCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar <strong>{unitName}</strong>. La unidad desaparece
              del listado pero se conserva la historia de reservas, tickets y
              liquidaciones para auditoría. Si la unidad tiene reservas
              activas o futuras, primero hay que cancelarlas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isPending && <Loader2 className="animate-spin" size={14} />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
