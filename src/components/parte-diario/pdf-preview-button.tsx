"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateParteDiarioPDF, generateParteDiarioPDFDoc } from "@/lib/pdf/parte-diario-pdf";
import type { ParteDiarioSnapshot } from "@/lib/types/database";

interface PdfPreviewButtonProps {
  snapshot: ParteDiarioSnapshot;
}

/**
 * Construye el PDF en el browser (jsPDF puro) y lo embebe en un iframe para
 * preview live. La descarga reusa el mismo doc — un solo build por click.
 */
export function PdfPreviewButton({ snapshot }: PdfPreviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const buildBlob = async () => {
    const doc = await generateParteDiarioPDFDoc(snapshot);
    const blob = doc.output("blob");
    return URL.createObjectURL(blob);
  };

  const handleOpenChange = async (next: boolean) => {
    if (next && !url) {
      setOpen(true);
      const built = await buildBlob();
      setUrl(built);
      return;
    }
    if (!next && url) {
      URL.revokeObjectURL(url);
      setUrl(null);
    }
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="size-3.5" />
          Vista previa
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="text-sm font-semibold">
            Vista previa · parte-diario-{snapshot.date}.pdf
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 bg-muted/30 overflow-hidden">
          {url ? (
            <iframe src={url} className="size-full" title="Parte diario PDF" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-card">
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void generateParteDiarioPDF(snapshot);
            }}
            className="gap-1.5"
          >
            <FileText className="size-3.5" />
            Descargar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
