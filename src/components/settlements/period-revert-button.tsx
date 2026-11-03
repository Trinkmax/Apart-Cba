"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { previewPeriodRevert, revertSettlementsForPeriod } from "@/lib/actions/settlements";
import { toastActionFailure } from "@/lib/action-failure";
import { formatMoney } from "@/lib/format";
import { MONTHS, formatPeriod } from "@/lib/settlements/labels";
import { REVERT_KEEP_LABEL, type PeriodRevertPreview } from "@/lib/settlements/period-revert";

/**
 * Deshace un «Generar todas» sobre el mes equivocado. Primero muestra qué va a
 * pasar: cuántos borradores se borran y cuáles quedan y por qué.
 */
export function PeriodRevertButton({
  year,
  month,
  onReverted,
}: {
  year: number;
  month: number;
  /** Después de revertir: a dónde sigue la persona (el mes correcto, si era otro). */
  onReverted: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PeriodRevertPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [reverting, startReverting] = useTransition();
  const period = formatPeriod(year, month);
  const count = preview?.ids.length ?? 0;
  const noun = count === 1 ? "borrador" : "borradores";

  function openDialog() {
    setOpen(true);
    setPreview(null);
    setLoadError(null);
    startLoading(async () => {
      try {
        const res = await previewPeriodRevert(year, month);
        if (res.ok) setPreview(res.preview);
        else setLoadError(res.error);
      } catch {
        setLoadError("No se pudo revisar el mes. Probá de nuevo.");
      }
    });
  }

  function revert() {
    if (!preview) return;
    startReverting(async () => {
      try {
        const res = await revertSettlementsForPeriod({ year, month, ids: preview.ids });
        if (!res.ok) {
          toast.error("No se pudo revertir", { description: res.error });
          router.refresh();
          return;
        }
        const kept = preview.kept.length;
        toast.success(
          `${res.deleted} ${res.deleted === 1 ? "borrador" : "borradores"} de ${period} ${res.deleted === 1 ? "eliminado" : "eliminados"}`,
          {
            description:
              kept > 0
                ? `${kept} ${kept === 1 ? "quedó" : "quedaron"} sin tocar: se resuelven de a una desde su detalle.`
                : "Las reservas no se tocaron: se puede volver a generar cuando quieras.",
          },
        );
        setOpen(false);
        onReverted();
      } catch (err) {
        toastActionFailure(err, "No se pudo revertir");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog} className="gap-2">
        <Undo2 size={15} />
        Revertir {MONTHS[month - 1]}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !reverting && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revertir {period}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {loading && (
                  <p className="flex items-center gap-2" role="status">
                    <Loader2 size={14} className="animate-spin" />
                    Revisando el mes…
                  </p>
                )}
                {loadError && (
                  <p className="text-rose-600 dark:text-rose-400" role="alert">
                    {loadError}
                  </p>
                )}
                {preview && count > 0 && (
                  <p>
                    Se eliminan{" "}
                    <span className="font-semibold text-foreground">
                      {count} {noun}
                    </span>
                    {preview.totals.length > 0 && (
                      <>
                        {" "}
                        por{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {preview.totals
                            .map((t) => formatMoney(t.amount, t.currency))
                            .join(" y ")}
                        </span>
                      </>
                    )}
                    . Las reservas y la Caja no se tocan, y los mantenimientos que tenían
                    vuelven a quedar para liquidar. Se puede volver a generar cuando quieras.
                  </p>
                )}
                {preview && count === 0 && (
                  <p>
                    No hay borradores sin tocar en {period}: no hay nada que revertir en
                    lote.
                  </p>
                )}
                {preview && preview.kept.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">
                      {preview.kept.length === 1
                        ? "Esta queda sin tocar:"
                        : `Estas ${preview.kept.length} quedan sin tocar:`}
                    </p>
                    <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
                      {preview.kept.map((k) => (
                        <li key={k.id} className="flex flex-wrap justify-between gap-x-3">
                          <span className="font-medium text-foreground">{k.owner_name}</span>
                          <span>{REVERT_KEEP_LABEL[k.reason]}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs">
                      Se resuelven de a una desde su detalle.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>
              {preview && count === 0 ? "Cerrar" : "Cancelar"}
            </AlertDialogCancel>
            {preview && count > 0 && (
              <AlertDialogAction
                disabled={reverting}
                className="bg-rose-600 hover:bg-rose-700"
                // Sin esto el diálogo se cierra antes de saber si funcionó.
                onClick={(e) => {
                  e.preventDefault();
                  revert();
                }}
              >
                {reverting && <Loader2 size={14} className="mr-2 animate-spin" />}
                Eliminar {count} {noun}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
