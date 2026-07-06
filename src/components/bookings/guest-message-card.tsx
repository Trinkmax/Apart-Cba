"use client";

import { useState } from "react";
import { Copy, Check, MessageCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Muestra el mensaje de confirmación ya completado con los datos de la reserva,
 * listo para copiar y mandar a mano. El texto se arma server-side con
 * `renderBookingConfirmationText`.
 *
 * OJO — por qué el botón de WhatsApp NO precarga el texto vía `wa.me?text=`:
 * en iOS ese pre-cargado rompe los emojis (los muestra como ◇ = U+FFFD) y puede
 * partir el link. El camino confiable es copiar al portapapeles y pegar: WhatsApp
 * renderiza los emojis nativos sin fallar. Así que el botón copia el mensaje y
 * abre el chat del huésped; el usuario solo pega.
 */
export function GuestMessageCard({
  message,
  phone,
}: {
  message: string;
  phone?: string | null;
}) {
  const [copied, setCopied] = useState(false);

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
      toast.success("Mensaje copiado", {
        description: "Pegalo donde quieras mandarlo.",
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("No se pudo copiar", {
        description: "Copialo manualmente desde el cuadro.",
      });
    }
  }

  // Copia (dentro del gesto del click, para que el navegador lo permita) y deja
  // que el <a> abra el chat. El usuario pega en el chat.
  function onWhatsApp() {
    void writeClipboard();
    toast.success("Mensaje copiado 📋", {
      description: "Pegalo en el chat de WhatsApp que se abrió.",
    });
  }

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

      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground bg-muted/40 border rounded-xl p-4">
        {message}
      </pre>
    </div>
  );
}
