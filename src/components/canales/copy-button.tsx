"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function CopyButton({
  value,
  getValue,
  label = "Copiar",
  copiedLabel = "Copiado",
  variant = "outline",
  size = "sm",
  className,
}: {
  value?: string;
  /** Para valores que se resuelven on-demand (p.ej. URL con token desde Vault). */
  getValue?: () => Promise<string>;
  label?: string;
  copiedLabel?: string;
  variant?: "outline" | "secondary" | "ghost" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onCopy() {
    try {
      setLoading(true);
      const v = value ?? (getValue ? await getValue() : "");
      if (!v) throw new Error("Nada para copiar");
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo copiar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onCopy}
      disabled={loading}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      {size !== "icon" && (copied ? copiedLabel : label)}
    </Button>
  );
}
