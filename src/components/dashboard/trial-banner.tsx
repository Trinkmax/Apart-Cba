"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { purgeTrialDemoData } from "@/lib/actions/trial";
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

/**
 * Aviso de cuenta de prueba. Sólo aparece mientras la org conserve los datos de
 * ejemplo del alta, y desaparece sola en cuanto se vacían.
 *
 * Es importante que el visitante sepa desde el primer segundo que lo que está
 * mirando es de mentira: sin este cartel, el primero que carga una reserva real
 * la mezcla con las de ejemplo y no la encuentra más.
 */
export function TrialBanner({ canPurge }: { canPurge: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await purgeTrialDemoData();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success("Listo. El panel quedó vacío para que cargues lo tuyo.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.07] px-3 py-1.5 sm:px-4 lg:px-6">
      <FlaskConical size={14} className="shrink-0 text-amber-500" />
      <p className="min-w-0 text-[11px] leading-tight text-amber-900 sm:text-xs dark:text-amber-200">
        <span className="font-medium">Cuenta de prueba.</span>{" "}
        <span className="hidden sm:inline">
          Los departamentos, reservas y movimientos son de ejemplo.
        </span>
      </p>

      {canPurge && (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 underline-offset-2 transition-colors hover:bg-amber-500/10 hover:underline sm:text-xs dark:text-amber-200"
            >
              Vaciar y cargar los míos
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Vaciar los datos de ejemplo?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borran los departamentos, propietarios, huéspedes, reservas, movimientos de
                caja, limpiezas y tickets de ejemplo. Tu cuenta, tu equipo y la configuración
                quedan como están. No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
                disabled={pending}
              >
                {pending && <Loader2 size={14} className="animate-spin" />}
                Vaciar datos de ejemplo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
