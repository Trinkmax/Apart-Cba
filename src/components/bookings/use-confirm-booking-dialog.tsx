"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmBookingDialog } from "./confirm-booking-dialog";
import { getBookingConfirmationPreview } from "@/lib/actions/booking-confirmation-preview";

interface UseConfirmBookingDialogProps {
  mode?: "confirm" | "resend";
  onSuccess?: () => void;
}

interface DialogState {
  open: boolean;
  preview: Parameters<typeof ConfirmBookingDialog>[0]["booking"] | null;
  template: Parameters<typeof ConfirmBookingDialog>[0]["initialTemplate"];
}

/**
 * Hook que devuelve:
 * - openConfirmDialog(bookingId): fetcha el preview + template y abre el dialog.
 * - dialogProps: spread en <ConfirmBookingDialog .../>
 * - ConfirmBookingDialog: re-export del componente.
 */
export function useConfirmBookingDialog({
  mode = "confirm",
  onSuccess,
}: UseConfirmBookingDialogProps = {}) {
  const [state, setState] = useState<DialogState>({ open: false, preview: null, template: null });
  const [, startTransition] = useTransition();

  function openConfirmDialog(bookingId: string) {
    startTransition(async () => {
      const result = await getBookingConfirmationPreview(bookingId);
      if (!result.ok) {
        toast.error("Error al cargar reserva", { description: result.error });
        return;
      }
      setState({ open: true, preview: result.preview, template: result.template });
    });
  }

  const dialogProps = state.preview
    ? {
        open: state.open,
        onOpenChange: (o: boolean) => setState((s) => ({ ...s, open: o })),
        booking: state.preview,
        initialTemplate: state.template,
        mode,
        onSuccess,
      }
    : null;

  return { openConfirmDialog, dialogProps, ConfirmBookingDialog };
}
