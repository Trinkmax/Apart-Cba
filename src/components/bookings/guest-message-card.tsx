"use client";

import { useState, useTransition } from "react";
import { Copy, Check, MessageCircle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { renderBookingConfirmationText } from "@/lib/email/booking-confirmation";
import { setBookingDeposit } from "@/lib/actions/bookings";

/**
 * Mensaje de confirmación ya completado + editor de seña con preview en vivo.
 * Al cambiar la seña el mensaje se re-renderiza al instante; "Guardar" la
 * persiste en la reserva (`deposit_amount`) para que también la use el email.
 *
 * El botón de WhatsApp NO precarga el texto vía `wa.me?text=` (en iOS eso rompe
 * los emojis → ◇): copia el mensaje y abre el chat; el usuario pega.
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
  listingUrl,
  phone,
  canEdit,
}: {
  bookingId: string;
  guestName: string;
  unitTitle: string;
  checkInIso: string;
  checkOutIso: string;
  guestsCount: number;
  currency: string;
  total: number;
  initialDeposit: number | null;
  listingUrl: string | null;
  phone?: string | null;
  canEdit: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [sena, setSena] = useState<string>(
    initialDeposit != null ? String(initialDeposit) : ""
  );
  const [saved, setSaved] = useState<number | null>(initialDeposit);
  const [pending, startTransition] = useTransition();

  const senaNum =
    sena.trim() === "" ? null : Math.max(0, Math.min(Number(sena) || 0, total));
  const restante = senaNum === null ? null : Math.max(0, total - senaNum);
  const dirty = senaNum !== saved;
  const pct = (p: number) => String(Math.round(total * p));

  const message = renderBookingConfirmationText({
    guestName,
    unitTitle,
    checkInIso,
    checkOutIso,
    guestsCount,
    currency,
    total,
    deposit: senaNum,
    listingUrl,
  });

  const waDigits = phone ? phone.replace(/[^\d]/g, "") : "";
  const waUrl = waDigits ? `https://wa.me/${waDigits}` : null;

  async function writeClipboard(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch {
      return false;
    }
  }

  async function copy() {
    if (await writeClipboard()) {
      setCopied(true);
      toast.success("Mensaje copiado", { description: "Pegalo donde quieras mandarlo." });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("No se pudo copiar", { description: "Copialo manualmente desde el cuadro." });
    }
  }

  function onWhatsApp() {
    void writeClipboard();
    toast.success("Mensaje copiado 📋", {
      description: "Pegalo en el chat de WhatsApp que se abrió.",
    });
  }

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
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
          >
            {copied ? (
              <Check size={14} className="text-emerald-600" />
            ) : (
              <Copy size={14} />
            )}
            {copied ? "Copiado" : "Copiar"}
          </button>
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onWhatsApp}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:brightness-95 transition"
            >
              <MessageCircle size={14} />
              Copiar y abrir chat
            </a>
          ) : null}
        </div>
      </div>

      {canEdit ? (
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

      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground bg-muted/40 border rounded-xl p-4">
        {message}
      </pre>
    </div>
  );
}
