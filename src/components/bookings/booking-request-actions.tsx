"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  approveBookingRequest,
  rejectBookingRequest,
} from "@/lib/actions/booking-requests";

export function BookingRequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function approve() {
    startTransition(async () => {
      const r = await approveBookingRequest(requestId);
      if (!r.ok) {
        toast.error("No se pudo aprobar", { description: r.error });
        return;
      }
      toast.success("Solicitud aprobada — booking creado");
      router.push(`/dashboard/reservas/${r.booking_id}`);
    });
  }

  function reject() {
    if (reason.trim().length < 5) {
      toast.error("Pasale una razón breve");
      return;
    }
    startTransition(async () => {
      const r = await rejectBookingRequest(requestId, reason);
      if (!r.ok) {
        toast.error("No se pudo rechazar", { description: r.error });
        return;
      }
      toast.success("Solicitud rechazada");
      setRejectOpen(false);
      router.push("/dashboard/reservas-pendientes");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <button
        onClick={approve}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        Aprobar y crear reserva
      </button>
      <button
        onClick={() => setRejectOpen(true)}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl border border-neutral-300 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60"
      >
        <X size={14} />
        Rechazar
      </button>

      {rejectOpen ? (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRejectOpen(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Rechazar solicitud</h3>
            <p className="text-sm text-neutral-600">
              El huésped va a recibir un email avisándole del rechazo y la razón.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Las fechas que pediste ya están ocupadas. Te recomiendo ver disponibilidad la semana siguiente..."
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm resize-y"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectOpen(false)} className="px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                onClick={reject}
                disabled={pending}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-60"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
