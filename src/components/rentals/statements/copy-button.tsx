"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Botón chico "copiar" (CBU, alias, link). Funciona en el panel y en el link público. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(`${label} copiado`);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copiar ${label.toLowerCase()}`}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {done ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  );
}
