"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, MessageCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

/**
 * "Copiar" + "Copiar y abrir chat" de un mensaje para el huésped.
 *
 * El botón de WhatsApp NO precarga el texto vía `wa.me?text=` (en iOS eso rompe
 * los emojis → ◇): copia el mensaje y abre el chat; el usuario pega.
 */
export function MessageCopyActions({
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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
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
  );
}

/**
 * La plantilla usa datos del depto que este depto no tiene cargados: el
 * mensaje saldría con ese renglón vacío.
 */
export function MissingUnitInfoNotice({
  missing,
  href,
}: {
  missing: string[];
  /** A dónde ir a cargarlos; sin permiso para hacerlo, sólo el aviso. */
  href?: string | null;
}) {
  if (missing.length === 0) return null;
  const lista =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} y ${missing[missing.length - 1]}`;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <TriangleAlert size={14} className="mt-0.5 shrink-0" />
      <p className="leading-snug">
        Falta cargar {lista} de este depto: en el mensaje{" "}
        {missing.length === 1 ? "queda vacío" : "quedan vacíos"}.{" "}
        {href ? (
          <Link href={href} className="font-medium underline underline-offset-2">
            Cargarlo
          </Link>
        ) : null}
      </p>
    </div>
  );
}
