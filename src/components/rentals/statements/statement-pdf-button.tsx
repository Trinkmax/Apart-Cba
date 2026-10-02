"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrgBranding } from "@/lib/pdf/org-header";
import type { StatementDocModel } from "./statement-model";

/** Descarga el PDF de la rendición (el generador se carga recién al hacer click). */
export function StatementPdfButton({
  model,
  branding,
  variant = "outline",
  size = "sm",
  className,
  label = "Descargar PDF",
}: {
  model: StatementDocModel;
  branding: OrgBranding;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
  label?: string;
}) {
  const [pending, start] = useTransition();

  function download() {
    start(async () => {
      try {
        const { generateRentalStatementPDF } = await import("@/lib/pdf/rental-statement-pdf");
        await generateRentalStatementPDF(model, branding);
      } catch {
        toast.error("No se pudo armar el PDF", { description: "Probá de nuevo en unos segundos." });
      }
    });
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={download} disabled={pending} className={className ?? "gap-2"}>
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </Button>
  );
}
