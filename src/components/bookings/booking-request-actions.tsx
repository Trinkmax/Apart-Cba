"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import {
  approveBookingRequest,
  rejectBookingRequest,
} from "@/lib/actions/booking-requests";

export function BookingRequestActions({
  requestId,
  total,
  currency,
}: {
  requestId: string;
  total: number;
  currency: string;
}) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Seña: arranca en 50% del total (lo más común). "" → a coordinar con el huésped.
  const [sena, setSena] = useState<string>(() =>
    total > 0 ? String(Math.round(total * 0.5)) : ""
  );
  const [pending, startTransition] = useTransition();

  const senaNum = sena.trim() === "" ? null : Math.max(0, Math.min(Number(sena) || 0, total));
  const restante = senaNum === null ? null : Math.max(0, total - senaNum);
  const pct = (p: number) => String(Math.round(total * p));

  function confirmApprove() {
    startTransition(async () => {
      const r = await approveBookingRequest(requestId, {
        deposit_amount: senaNum,
      });
      if (!r.ok) {
        toast.error("No se pudo aprobar", { description: r.error });
        return;
      }
      toast.success("Solicitud aprobada", {
        description: "El huésped recibió el email de confirmación.",
      });
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
        onClick={() => setApproveOpen(true)}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
      >
        <Check size={14} />
        Aprobar y confirmar
      </button>
      <button
        onClick={() => setRejectOpen(true)}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl border border-neutral-300 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60"
      >
        <X size={14} />
        Rechazar
      </button>

      {/* Modal de aprobación con seña */}
      {approveOpen ? (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !pending && setApproveOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-neutral-900">
                Confirmar reserva
              </h3>
              <p className="text-sm text-neutral-600">
                Se crea la reserva y el huésped recibe el email de confirmación
                con el detalle de pago.
              </p>
            </div>

            <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-600">Monto total</span>
                <span className="text-base font-semibold text-neutral-900">
                  {formatMoney(total, currency)}
                </span>
              </div>

              <div>
                <label className="text-sm text-neutral-600 block mb-1.5">
                  Seña a informar
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                    {currency}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={total}
                    value={sena}
                    onChange={(e) => setSena(e.target.value)}
                    placeholder="A coordinar"
                    className="w-full h-11 pl-12 pr-3 rounded-lg border border-neutral-300 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { label: "30%", v: pct(0.3) },
                    { label: "50%", v: pct(0.5) },
                    { label: "Total", v: pct(1) },
                  ].map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setSena(c.v)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        sena === c.v
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSena("")}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      sena.trim() === ""
                        ? "bg-neutral-800 text-white border-neutral-800"
                        : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400"
                    }`}
                  >
                    Sin seña
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-neutral-200">
                <span className="text-sm text-neutral-600">
                  Restante al ingresar
                </span>
                <span className="text-base font-semibold text-emerald-700">
                  {restante === null ? "—" : formatMoney(restante, currency)}
                </span>
              </div>
            </div>

            <p className="text-xs text-neutral-500 leading-relaxed">
              {senaNum === null
                ? "El email dirá “Seña: a coordinar con el anfitrión”."
                : "La seña va en el email (Seña + Restante). No registra un movimiento en Caja — el cobro lo cargás en Caja cuando lo recibís."}
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveOpen(false)}
                disabled={pending}
                className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={confirmApprove}
                disabled={pending}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Mail size={14} />
                )}
                Aprobar y enviar confirmación
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal de rechazo */}
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
