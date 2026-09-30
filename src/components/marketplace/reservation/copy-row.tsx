"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "./copy-link-button";

/**
 * Dato para copiar con un toque, como `CopyField` de la marca pero SIN cortar
 * el texto: en un celular de 360 px un CBU (22 dígitos) o un alias largo no
 * entran en una línea, y un CBU con "…" es justo lo que no puede pasar. El
 * valor se muestra agrupado y corta en los espacios.
 */
export function CopyRow({
  label,
  value,
  display,
  mono = false,
  emphasis = false,
  className,
}: {
  label: string;
  /** Lo que se copia (sin espacios ni símbolos). */
  value: string;
  /** Lo que se muestra (por defecto, value). */
  display?: string;
  mono?: boolean;
  /** Monto: más grande. */
  emphasis?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl bg-paper py-3 pl-4 pr-2 ring-1 ring-cream-300",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">{label}</p>
        <p
          className={cn(
            "mt-0.5 break-words font-semibold text-forest-700",
            emphasis ? "text-lg tabular-nums" : "text-[0.9375rem]",
            mono && "font-mono tracking-tight",
          )}
        >
          {display ?? value}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold outline-none transition-colors",
          "focus-visible:ring-[3px] focus-visible:ring-forest-500/30",
          copied ? "bg-forest-700 text-cream" : "bg-leaf-100 text-forest-700 hover:bg-leaf-200",
        )}
        aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        <span aria-live="polite">{copied ? "Copiado" : "Copiar"}</span>
      </button>
    </div>
  );
}
