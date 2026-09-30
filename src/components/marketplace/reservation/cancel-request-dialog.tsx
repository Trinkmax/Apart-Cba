"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { FormAlert } from "@/components/marketplace/shell/form-fields";
import { cancelReservationRequest } from "@/lib/actions/reservation-status";
import { BrandDialogContent } from "./brand-dialog";

/**
 * "Cancelar pedido" mientras el equipo todavía no respondió. Pide confirmación
 * (no se deshace) y, si sale bien, refresca la página: el seguimiento pasa a
 * "Cancelaste tu pedido".
 */
export function CancelRequestDialog({
  token,
  requestId,
  className,
}: {
  token?: string | null;
  requestId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cancelReservationRequest(
          token ? { token } : { requestId: requestId ?? undefined },
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("No pudimos cancelar el pedido. Revisá tu conexión y probá de nuevo.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <ApartButton variant="ghost" size="lg" className={className}>
          Cancelar pedido
        </ApartButton>
      </DialogTrigger>
      <BrandDialogContent
        title="¿Cancelamos tu pedido?"
        description="Liberamos las fechas y no queda nada pendiente. Si después cambiás de idea, armás un pedido nuevo en un minuto."
      >
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <ApartButton variant="secondary" size="lg" disabled={pending} className="w-full sm:w-auto">
              No, mantenerlo
            </ApartButton>
          </DialogClose>
          <ApartButton
            variant="primary"
            size="lg"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
            className="w-full sm:w-auto"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Cancelando…" : "Sí, cancelar pedido"}
          </ApartButton>
        </div>
      </BrandDialogContent>
    </Dialog>
  );
}
