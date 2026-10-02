"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copia un texto al portapapeles con confirmación visual (ícono → tilde por 2 s). */
export function CopyTextButton({
  text,
  label,
  toastTitle = "Copiado",
  iconOnly,
  size = "sm",
  variant = "outline",
  className,
}: {
  text: string;
  label?: string;
  toastTitle?: string;
  iconOnly?: boolean;
  size?: "sm" | "default" | "icon-sm";
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(toastTitle);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
    }
  }

  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : size}
      variant={variant}
      onClick={copy}
      className={cn(!iconOnly && "gap-1.5", className)}
      aria-label={iconOnly ? label ?? "Copiar" : undefined}
      title={iconOnly ? label ?? "Copiar" : undefined}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      {!iconOnly && (label ?? "Copiar")}
    </Button>
  );
}
