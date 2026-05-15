"use client";

import { useTransition } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { StatementInput } from "@/lib/settlements/statement-model";

export type ExportBranding = {
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

/** Descarga Excel/PDF. Los builders se importan lazy (exceljs/jspdf pesan). */
export function SettlementExportButtons({
  input,
  branding,
}: {
  input: StatementInput;
  branding: ExportBranding;
}) {
  const [pending, start] = useTransition();

  function exportXlsx() {
    start(async () => {
      try {
        const m = await import("@/lib/excel/settlement-xlsx");
        await m.downloadSettlementXlsx(input, branding);
      } catch (e) {
        toast.error("Error generando Excel", {
          description: (e as Error).message,
        });
      }
    });
  }

  function exportPdf() {
    start(async () => {
      try {
        const m = await import("@/lib/pdf/settlement-pdf");
        await m.generateSettlementPDF(input, branding);
      } catch (e) {
        toast.error("Error generando PDF", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={exportXlsx}
        disabled={pending}
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <FileSpreadsheet size={14} />
        )}
        Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={exportPdf}
        disabled={pending}
      >
        <FileText size={14} /> PDF
      </Button>
    </>
  );
}
