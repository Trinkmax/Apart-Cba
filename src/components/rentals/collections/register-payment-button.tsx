"use client";

import { useState, type ReactNode } from "react";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PaymentDialog, type PaymentRegistered } from "./payment-dialog";

export interface RegisterPaymentButtonProps {
  contractId: string;
  defaultAmount?: number | null;
  /**
   * Fecha del pago con la que abre el diálogo (YYYY-MM-DD). Para un aviso del
   * portal es la que informó el inquilino: los punitorios se calculan a ESA
   * fecha, no al día en que alguien lo registra.
   */
  defaultPaidAt?: string | null;
  preferChargeIds?: string[];
  reportId?: string | null;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  /** Texto del botón (default "Registrar cobro"). */
  children?: ReactNode;
  className?: string;
  /** Se llama cuando el cobro quedó registrado (el diálogo sigue abierto con el recibo). */
  onRegistered?: (r: PaymentRegistered) => void;
}

/** Botón verde "Registrar cobro" que abre el diálogo con la vista previa del servidor. */
export function RegisterPaymentButton({
  contractId,
  defaultAmount,
  defaultPaidAt,
  preferChargeIds,
  reportId,
  size = "default",
  variant = "default",
  children,
  className,
  onRegistered,
}: RegisterPaymentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        className={cn(
          "gap-2",
          variant === "default"
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
          className,
        )}
      >
        <HandCoins size={14} />
        {children ?? "Registrar cobro"}
      </Button>
      <PaymentDialog
        contractId={contractId}
        open={open}
        onOpenChange={setOpen}
        defaultAmount={defaultAmount}
        defaultPaidAt={defaultPaidAt}
        preferChargeIds={preferChargeIds}
        reportId={reportId}
        onRegistered={onRegistered}
      />
    </>
  );
}
