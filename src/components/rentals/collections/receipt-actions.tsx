"use client";

import { useState, useTransition } from "react";
import { Ban, Download, Mail, MessageCircle, MoreHorizontal, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getReceiptData, getReceiptWhatsapp, sendReceiptEmail } from "@/lib/actions/rentals-collections";
import { formatReceiptNumber } from "@/lib/rentals/labels";
import { cn } from "@/lib/utils";
import { Spinner, WhatsappMessageDialog } from "./whatsapp-message-dialog";

type Size = "sm" | "default";
type Variant = "default" | "outline" | "ghost" | "secondary";

/** Descarga el recibo: los datos vienen del servidor y el PDF se arma acá (jsPDF se carga recién al tocar). */
export function useReceiptPdf() {
  const [pending, startTransition] = useTransition();
  function download(paymentId: string) {
    startTransition(async () => {
      try {
        const res = await getReceiptData(paymentId);
        if (!res.ok) {
          toast.error("No se pudo armar el recibo", { description: res.error });
          return;
        }
        const { generateRentalReceiptPDF } = await import("@/lib/pdf/rental-receipt-pdf");
        await generateRentalReceiptPDF(res.data);
      } catch (e) {
        toast.error("No se pudo armar el recibo", { description: (e as Error).message });
      }
    });
  }
  return { download, pending };
}

export function useReceiptEmail() {
  const [pending, startTransition] = useTransition();
  function send(paymentId: string, onSent?: (to: string) => void) {
    startTransition(async () => {
      const res = await sendReceiptEmail(paymentId);
      if (!res.ok) {
        toast.error("No se pudo mandar el recibo", { description: res.error });
        return;
      }
      toast.success("Recibo enviado", { description: `Le llegó a ${res.to} con el PDF adjunto.` });
      onSent?.(res.to);
    });
  }
  return { send, pending };
}

export function ReceiptPdfButton({ paymentId, size = "sm", variant = "outline", className, children }: {
  paymentId: string;
  size?: Size;
  variant?: Variant;
  className?: string;
  children?: React.ReactNode;
}) {
  const { download, pending } = useReceiptPdf();
  return (
    <Button size={size} variant={variant} className={cn("gap-2", className)} onClick={() => download(paymentId)} disabled={pending}>
      {pending ? <Spinner /> : <Download size={14} />}
      {children ?? "Descargar PDF"}
    </Button>
  );
}

export function ReceiptEmailButton({ paymentId, email, size = "sm", variant = "outline", className, onSent }: {
  paymentId: string;
  email: string | null;
  size?: Size;
  variant?: Variant;
  className?: string;
  onSent?: (to: string) => void;
}) {
  const { send, pending } = useReceiptEmail();
  return (
    <Button
      size={size}
      variant={variant}
      className={cn("gap-2", className)}
      onClick={() => send(paymentId, onSent)}
      disabled={pending || !email}
      title={email ? `Se manda a ${email}` : "El inquilino no tiene mail cargado"}
    >
      {pending ? <Spinner /> : <Mail size={14} />}
      {email ? "Enviar por mail" : "Sin mail cargado"}
    </Button>
  );
}

export function ReceiptWhatsappButton({ paymentId, size = "sm", variant = "outline", className }: {
  paymentId: string;
  size?: Size;
  variant?: Variant;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={cn("gap-2", className)} onClick={() => setOpen(true)}>
        <MessageCircle size={14} /> Mensaje de WhatsApp
      </Button>
      <WhatsappMessageDialog
        open={open}
        onOpenChange={setOpen}
        title="Recibo por WhatsApp"
        description="Revisalo, copialo y pegalo en el chat del inquilino."
        load={() => getReceiptWhatsapp(paymentId)}
      />
    </>
  );
}

/** Menú "…" de un recibo (cuenta corriente, tablero). */
export function ReceiptMenu({ paymentId, receiptNumber, email, voided, onVoid, triggerClassName }: {
  paymentId: string;
  receiptNumber: number | null;
  email: string | null;
  voided?: boolean;
  onVoid?: () => void;
  triggerClassName?: string;
}) {
  const { download, pending: pdfPending } = useReceiptPdf();
  const { send, pending: mailPending } = useReceiptEmail();
  const [waOpen, setWaOpen] = useState(false);
  const busy = pdfPending || mailPending;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={triggerClassName} aria-label={`Acciones del recibo ${formatReceiptNumber(receiptNumber)}`} disabled={busy}>
            {busy ? <Spinner /> : <MoreHorizontal size={16} />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Receipt size={13} /> Recibo N° {formatReceiptNumber(receiptNumber)}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => download(paymentId)}>
            <Download size={14} /> Descargar PDF
          </DropdownMenuItem>
          {!voided && (
            <>
              <DropdownMenuItem disabled={!email} onSelect={() => send(paymentId)}>
                <Mail size={14} /> {email ? "Mandar por mail" : "Mandar por mail (sin mail cargado)"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setWaOpen(true)}>
                <MessageCircle size={14} /> Mensaje de WhatsApp
              </DropdownMenuItem>
            </>
          )}
          {onVoid && !voided && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onVoid}>
                <Ban size={14} /> Anular cobro…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <WhatsappMessageDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title="Recibo por WhatsApp"
        description="Revisalo, copialo y pegalo en el chat del inquilino."
        load={() => getReceiptWhatsapp(paymentId)}
      />
    </>
  );
}
