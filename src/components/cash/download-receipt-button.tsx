"use client";

import { useState, useTransition } from "react";
import { Download, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPaymentReceiptData } from "@/lib/actions/cash";

type Variant = "default" | "outline" | "ghost" | "secondary";

interface Props {
  movementId: string;
  variant?: Variant;
  size?: "default" | "sm" | "icon";
  label?: string;
  className?: string;
  iconOnly?: boolean;
  /** Detiene la propagación del click (útil dentro de filas clickeables). */
  stopPropagation?: boolean;
}

export function DownloadReceiptButton({
  movementId,
  variant = "outline",
  size = "sm",
  label = "Comprobante",
  className,
  iconOnly = false,
  stopPropagation = false,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    startTransition(async () => {
      try {
        const [data, mod] = await Promise.all([
          getPaymentReceiptData(movementId),
          import("@/lib/pdf/payment-receipt-pdf"),
        ]);
        await mod.generatePaymentReceiptPDF(data);
        setDone(true);
        // Reset el "check" después de un momento
        window.setTimeout(() => setDone(false), 2200);
      } catch (err) {
        toast.error("No se pudo generar el comprobante", {
          description: (err as Error).message,
        });
      }
    });
  }

  const Icon = isPending ? Loader2 : done ? FileCheck2 : Download;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={isPending}
      aria-label={label}
      title={label}
      className={cn(
        "gap-1.5 transition-all duration-300",
        done && "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30",
        className
      )}
    >
      <Icon
        size={size === "icon" ? 14 : 14}
        className={cn(
          "transition-transform duration-300",
          isPending && "animate-spin",
          done && !isPending && "scale-110"
        )}
      />
      {!iconOnly && (
        <span className="transition-all">
          {isPending ? "Generando…" : done ? "Listo" : label}
        </span>
      )}
    </Button>
  );
}
