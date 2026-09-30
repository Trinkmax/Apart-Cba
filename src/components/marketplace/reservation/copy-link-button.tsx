"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { cn } from "@/lib/utils";

/** Copia al portapapeles con fallback para navegadores sin permiso. */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/**
 * "Copiar link" del seguimiento. El link ES la llave del huésped (no hace
 * falta cuenta), así que conviene guardarlo.
 */
export function CopyLinkButton({
  path,
  label = "Copiar link",
  variant = "soft",
  className,
}: {
  /** Path interno (/reserva/<token>); se copia con el origen actual. */
  path: string;
  label?: string;
  variant?: "soft" | "secondary" | "inverse";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const ok = await copyText(`${window.location.origin}${path}`);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ApartButton type="button" variant={variant} size="md" onClick={onClick} className={cn("min-w-[9.5rem]", className)}>
      {copied ? <Check aria-hidden /> : <Link2 aria-hidden />}
      <span aria-live="polite">{copied ? "Link copiado" : label}</span>
    </ApartButton>
  );
}
