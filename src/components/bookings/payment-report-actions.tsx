"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { getPaymentReceiptUrl, resolvePaymentReport } from "@/lib/actions/payment-reports";

/**
 * Acciones sobre un aviso de pago del huésped: ver el comprobante (URL
 * firmada, 10 min) y marcarlo registrado o descartado. Un aviso NO es un
 * cobro: "registrado" pide primero cargar el cobro en Caja.
 */

/** Abre el comprobante. La pestaña se abre antes del await para que Safari no la bloquee. */
export function ReceiptButton({ reportId, compact = false }: { reportId: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    const win = window.open("", "_blank");
    setLoading(true);
    try {
      const r = await getPaymentReceiptUrl(reportId);
      if (!r.ok) {
        win?.close();
        toast.error(r.error);
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = r.url;
      } else {
        window.location.assign(r.url);
      }
    } catch {
      win?.close();
      toast.error("No pudimos abrir el comprobante. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={open}
      disabled={loading}
      className={cn(!compact && "min-h-10 sm:min-h-8")}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileText className="size-3.5" aria-hidden />}
      Ver comprobante
    </Button>
  );
}

type Mode = "registrado" | "descartado";

export function ResolveReportButtons({
  reportId,
  bookingId,
  amount,
  currency,
  showBookingLink = true,
}: {
  reportId: string;
  bookingId: string;
  amount: number | null;
  currency: string;
  /** En el detalle de la reserva no hace falta "Ir a la reserva". */
  showBookingLink?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, startTransition] = useTransition();

  function resolve(status: Mode) {
    startTransition(async () => {
      const r = await resolvePaymentReport({ reportId, status });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (status === "descartado") {
        toast.success("Aviso descartado.");
      } else if (r.senaCovered) {
        toast.success(
          r.emailSent
            ? "Aviso registrado. La seña está cubierta y le avisamos al huésped."
            : "Aviso registrado. La seña está cubierta.",
        );
      } else {
        toast.warning("Aviso registrado, pero la seña todavía no figura cubierta", {
          description:
            r.missing > 0
              ? `Faltan ${formatMoney(r.missing, currency)}. ¿Cargaste el cobro en Caja?`
              : "¿Cargaste el cobro en Caja?",
          duration: 10_000,
        });
      }
      setMode(null);
      router.refresh();
    });
  }

  const amountText = amount != null ? formatMoney(amount, currency) : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showBookingLink ? (
          <Button asChild variant="ghost" size="sm" className="min-h-10 sm:min-h-8">
            <Link href={`/dashboard/reservas/${bookingId}`}>Ir a la reserva</Link>
          </Button>
        ) : null}
        <Button type="button" size="sm" className="min-h-10 sm:min-h-8" onClick={() => setMode("registrado")} disabled={pending}>
          <Check className="size-3.5" aria-hidden />
          Marcar como registrado
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 sm:min-h-8 text-muted-foreground"
          onClick={() => setMode("descartado")}
          disabled={pending}
        >
          <Trash2 className="size-3.5" aria-hidden />
          Descartar
        </Button>
      </div>

      <Dialog open={mode != null} onOpenChange={(o) => !pending && !o && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          {mode === "registrado" ? (
            <>
              <DialogHeader>
                <DialogTitle>¿Ya registraste el cobro?</DialogTitle>
                <DialogDescription>
                  Primero registrá el cobro en Caja{amountText ? ` (${amountText})` : ""} desde la reserva. Un aviso del huésped
                  no suma a lo cobrado: marcarlo sólo lo saca de la lista. Si con ese cobro la seña queda cubierta, le avisamos
                  que su reserva está asegurada.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                {showBookingLink ? (
                  <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
                    <Link href={`/dashboard/reservas/${bookingId}`} onClick={() => setMode(null)}>
                      Ir a registrarlo
                    </Link>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setMode(null)} disabled={pending}>
                    Todavía no
                  </Button>
                )}
                <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => resolve("registrado")} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  Sí, ya está en Caja
                </Button>
              </DialogFooter>
            </>
          ) : mode === "descartado" ? (
            <>
              <DialogHeader>
                <DialogTitle>Descartar aviso</DialogTitle>
                <DialogDescription>
                  Usalo si el aviso está repetido, el monto no corresponde o fue una prueba. El huésped no recibe nada y el
                  aviso sale de la lista.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setMode(null)} disabled={pending}>
                  Volver
                </Button>
                <Button type="button" variant="destructive" className="min-h-11 sm:min-h-9" onClick={() => resolve("descartado")} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                  Descartar
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
