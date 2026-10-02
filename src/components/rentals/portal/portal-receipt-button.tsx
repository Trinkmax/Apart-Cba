"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTenantReceiptData } from "@/lib/actions/rentals-portal";

/** Baja el recibo en PDF desde el portal (el PDF se arma en el teléfono, sin pasar por el servidor). */
export function PortalReceiptButton({ token, paymentId, receiptNumber }: { token: string; paymentId: string; receiptNumber: string }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const res = await getTenantReceiptData(token, paymentId);
      if (!res.ok) {
        toast.error("No se pudo bajar el recibo", { description: res.error });
        return;
      }
      try {
        const { generateRentalReceiptPDF } = await import("@/lib/pdf/rental-receipt-pdf");
        await generateRentalReceiptPDF(res.data);
      } catch {
        toast.error("No se pudo armar el PDF", { description: "Probá de nuevo en un rato." });
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-10 shrink-0 gap-1.5"
      onClick={download}
      disabled={pending}
      aria-label={`Bajar el recibo N° ${receiptNumber}`}
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      Recibo
    </Button>
  );
}
