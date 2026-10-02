"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Botón chico "copiar" (N° de cuenta, CBU, alias…). */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(`${label} copiado`, { description: value });
      setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={copy}
      aria-label={`Copiar ${label.toLowerCase()}`}
      title={`Copiar ${label.toLowerCase()}`}
      className={cn("size-8 shrink-0 text-muted-foreground hover:text-foreground", className)}
    >
      {done ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </Button>
  );
}
