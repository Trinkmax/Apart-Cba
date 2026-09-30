"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dato para copiar con un toque (alias, CBU, monto, código de reserva). En el
 * celular copiar a mano un CBU de 22 dígitos es donde se equivoca la gente.
 */
export function CopyField({
  label,
  value,
  display,
  mono = false,
  className,
}: {
  label: string;
  /** Lo que se copia. */
  value: string;
  /** Lo que se muestra (por defecto, value). */
  display?: string;
  mono?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Safari viejo / contexto sin permisos: fallback con selección.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3 ring-1 ring-cream-300", className)}>
      <div className="min-w-0">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-500">{label}</p>
        <p className={cn("mt-0.5 truncate text-[0.9375rem] font-semibold text-forest-700", mono && "font-mono tracking-tight")}>
          {display ?? value}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
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
