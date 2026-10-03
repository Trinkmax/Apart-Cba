"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { getRentalsShutdownImpact, setRentalsEnabled } from "@/lib/actions/rentals-settings";

/** Encender / apagar el módulo de alquileres tradicionales para la organización. */
export function RentalsModuleToggle({ enabled: initial }: { enabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [confirmOff, setConfirmOff] = useState(false);
  const [impact, setImpact] = useState<{ active: number; links: number } | null>(null);

  // Apagar frena la cobranza de toda la organización y corta los links de los
  // inquilinos: no puede pasar de un toque. El switch queda prendido hasta
  // que se confirma; los números llegan después de abrir (el aviso no espera).
  function onSwitch(next: boolean) {
    if (next) {
      toggle(true);
      return;
    }
    setImpact(null);
    setConfirmOff(true);
    // Sin los números el aviso igual dice qué pasa: un error acá no frena nada.
    void getRentalsShutdownImpact()
      .then((res) => {
        if (res.ok) setImpact({ active: res.active, links: res.links });
      })
      .catch(() => undefined);
  }

  function toggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const res = await setRentalsEnabled(next);
      if (!res.ok) {
        setEnabled(!next);
        toast.error("No se pudo cambiar el módulo", { description: res.error });
        return;
      }
      setConfirmOff(false);
      toast.success(next ? "Alquileres tradicionales activado" : "Alquileres tradicionales desactivado", {
        description: next
          ? "Ya aparece en el menú como «Tradicionales», dentro de Operación. Empezá cargando el primer contrato."
          : "Se ocultó del menú y se pausaron los links de los inquilinos y la cobranza automática. Los datos quedan guardados.",
      });
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#0d9488] text-white shadow-sm">
          <KeyRound size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Alquileres tradicionales</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Contratos de 2 y 3 años con ajuste por índice, cobranza mensual con recibos, control de expensas y servicios, y
                rendiciones a propietarios. Independiente de los alquileres temporarios.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {pending && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
              <Switch checked={enabled} onCheckedChange={onSwitch} disabled={pending} aria-label="Activar alquileres tradicionales" />
            </div>
          </div>
          {enabled && !pending && (
            <Link href="/dashboard/alquileres" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#0d9488] hover:underline">
              Ir a Tradicionales <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOff} onOpenChange={(open) => !pending && setConfirmOff(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar Alquileres tradicionales?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Mientras esté apagado:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>«Tradicionales» desaparece del menú y nadie del equipo puede cargar cobros, gastos ni rendiciones.</li>
                  <li>
                    Los links de los inquilinos dejan de funcionar: les aparece «Este link no funciona».
                    {impact && impact.links > 0 ? ` Hoy hay ${impact.links} ${impact.links === 1 ? "link activo" : "links activos"}.` : ""}
                  </li>
                  <li>
                    No se generan los cargos del mes, no se aplican los ajustes y no te llegan los avisos de mora, ajustes ni vencimientos.
                    {impact && impact.active > 0
                      ? ` Afecta a ${impact.active} ${impact.active === 1 ? "contrato vigente" : "contratos vigentes"}.`
                      : ""}
                  </li>
                  <li>Las rendiciones que ya les mandaste a los propietarios se siguen viendo.</li>
                </ul>
                <p>Los datos quedan guardados. Al reactivarlo vuelve todo y los cargos atrasados se generan solos.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                toggle(false);
              }}
              disabled={pending}
              className="bg-rose-600 hover:bg-rose-700 text-white gap-2"
            >
              {pending && <Loader2 size={14} className="animate-spin" />} Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
