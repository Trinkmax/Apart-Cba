"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Save, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import {
  renderBookingConfirmationText,
  effectiveSena,
} from "@/lib/email/booking-confirmation";
import {
  missingUnitFields,
  renderGuestMessage,
  templateUsesDeposit,
  withDeposit,
  type BookingMessageVariables,
} from "@/lib/email/booking-message";
import { setBookingDeposit } from "@/lib/actions/bookings";
import { MessageCopyActions, MissingUnitInfoNotice } from "./guest-message-parts";

/**
 * Mensaje de confirmación ya completado + editor de seña con preview en vivo.
 * Al cambiar la seña el mensaje se re-renderiza al instante; "Guardar" la
 * persiste en la reserva (`deposit_amount`) para que también la use el email.
 *
 * El texto es el de la "Confirmación de reserva" de la org (Configuración →
 * Comunicaciones) si la editó; si no, el mensaje original del dueño. La seña
 * sólo se ofrece si el mensaje la muestra: hay orgs que no cobran seña.
 */
export function GuestMessageCard({
  bookingId,
  guestName,
  unitTitle,
  checkInIso,
  checkOutIso,
  guestsCount,
  currency,
  total,
  initialDeposit,
  paidAmount,
  securityDeposit,
  phone,
  canEdit,
  customTemplate,
  variables,
  editHref,
  unitInfoHref,
}: {
  bookingId: string;
  guestName: string;
  unitTitle: string;
  checkInIso: string;
  checkOutIso: string;
  guestsCount: number;
  currency: string;
  total: number;
  /** Seña informada explícita (deposit_amount). Si es null se usa lo cobrado. */
  initialDeposit: number | null;
  /** Lo ya cobrado en la reserva ("Cobrado" = paid_amount). Fuente por defecto de la seña. */
  paidAmount: number;
  /** Depósito en garantía (reservas mensuales). Solo lectura acá; se carga en la reserva. */
  securityDeposit: number | null;
  phone?: string | null;
  canEdit: boolean;
  /** Plantilla editada por la org. null = mensaje original. */
  customTemplate?: string | null;
  /** Datos de la reserva para completar la plantilla. */
  variables: BookingMessageVariables;
  /** Dónde se edita el mensaje (sólo para quien puede). */
  editHref?: string | null;
  /** Dónde se cargan los datos del depto (sólo para quien puede). */
  unitInfoHref?: string | null;
}) {
  // La seña suele ser el valor de una noche → default + chip de acceso rápido.
  const nights = Math.max(
    1,
    Math.round(
      (new Date(checkOutIso + "T12:00:00").getTime() -
        new Date(checkInIso + "T12:00:00").getTime()) /
        86_400_000
    )
  );
  const oneNight = Math.round(total / nights);
  // Seña por defecto: la explícita (deposit_amount) → lo cobrado ("Cobrado" =
  // paidAmount) → el valor de una noche. Así el mensaje sale siempre completo,
  // con seña y restante, sin re-tipear nada. Ver effectiveSena().
  const effectiveInitialDeposit = effectiveSena(initialDeposit, paidAmount, oneNight);
  const [sena, setSena] = useState<string>(
    effectiveInitialDeposit != null ? String(effectiveInitialDeposit) : ""
  );
  const [saved, setSaved] = useState<number | null>(effectiveInitialDeposit);
  const [pending, startTransition] = useTransition();

  const senaNum =
    sena.trim() === "" ? null : Math.max(0, Math.min(Number(sena) || 0, total));
  const restante = senaNum === null ? null : Math.max(0, total - senaNum);
  const dirty = senaNum !== saved;
  const pct = (p: number) => String(Math.round(total * p));

  const custom = customTemplate ?? null;
  const showSena = canEdit && (custom === null || templateUsesDeposit(custom));
  const missing = custom === null ? [] : missingUnitFields(custom, variables);

  const message =
    custom !== null
      ? renderGuestMessage(custom, withDeposit(variables, senaNum, total))
      : renderBookingConfirmationText({
          guestName,
          unitTitle,
          checkInIso,
          checkOutIso,
          guestsCount,
          currency,
          total,
          deposit: senaNum,
          securityDeposit,
        });

  function saveSena() {
    startTransition(async () => {
      const r = await setBookingDeposit(bookingId, senaNum);
      if (!r.ok) {
        toast.error("No se pudo guardar la seña", { description: r.error });
        return;
      }
      setSaved(r.deposit);
      setSena(r.deposit != null ? String(r.deposit) : "");
      toast.success("Seña guardada", {
        description: "Queda en la reserva y en el email de confirmación.",
      });
    });
  }

  const chipCls =
    "px-2.5 py-1 rounded-full text-xs font-medium border border-input bg-background hover:bg-accent transition-colors";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
            Mensaje para el huésped
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ya completado con los datos. Copialo y pegalo en WhatsApp.
            {editHref ? (
              <>
                {" "}
                <Link
                  href={editHref}
                  className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                >
                  <PencilLine size={12} />
                  Editar el mensaje
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <MessageCopyActions message={message} phone={phone} />
      </div>

      {showSena ? (
        <div className="rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-xs font-medium text-muted-foreground">
              Seña a informar
            </label>
            <span className="text-xs text-muted-foreground">
              Restante:{" "}
              <span className="font-semibold text-foreground">
                {restante === null ? "—" : formatMoney(restante, currency)}
              </span>
            </span>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground mt-1">
            Por defecto toma lo cobrado en la reserva. Ajustala si querés.
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {currency}
              </span>
              <input
                type="number"
                min={0}
                max={total}
                value={sena}
                onChange={(e) => setSena(e.target.value)}
                placeholder="A coordinar"
                className="h-9 w-40 pl-11 pr-2 rounded-lg border border-input bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <button
              type="button"
              onClick={() => setSena(String(oneNight))}
              className={chipCls}
            >
              1 noche
            </button>
            <button type="button" onClick={() => setSena(pct(0.3))} className={chipCls}>
              30%
            </button>
            <button type="button" onClick={() => setSena(pct(0.5))} className={chipCls}>
              50%
            </button>
            <button type="button" onClick={() => setSena("")} className={chipCls}>
              Sin seña
            </button>
            <button
              type="button"
              onClick={saveSena}
              disabled={pending || !dirty}
              className={`ml-auto inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                dirty
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "border border-input bg-background text-muted-foreground"
              }`}
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {dirty ? "Guardar" : "Guardado"}
            </button>
          </div>
        </div>
      ) : null}

      <MissingUnitInfoNotice missing={missing} href={unitInfoHref} />

      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground bg-muted/40 border rounded-xl p-4">
        {message}
      </pre>
    </div>
  );
}
