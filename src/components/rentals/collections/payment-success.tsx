"use client";

import { useState } from "react";
import { Check, Download, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getReceiptWhatsapp } from "@/lib/actions/rentals-collections";
import { formatMoney } from "@/lib/format";
import { formatReceiptNumber } from "@/lib/rentals/labels";
import { cn } from "@/lib/utils";
import { useReceiptEmail, useReceiptPdf } from "./receipt-actions";
import { Spinner, WhatsappMessageDialog } from "./whatsapp-message-dialog";

function ActionTile({
  icon,
  title,
  hint,
  onClick,
  pending,
  disabled,
  done,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  done?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all min-h-14",
        "hover:border-emerald-500/40 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
        "disabled:opacity-50 disabled:pointer-events-none",
      )}
    >
      <span
        className={cn(
          "size-9 shrink-0 rounded-lg flex items-center justify-center transition-colors",
          done ? "bg-emerald-600 text-white" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        )}
      >
        {pending ? <Spinner /> : done ? <Check size={16} /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[11px] text-muted-foreground truncate">{hint}</span>
      </span>
    </button>
  );
}

export function PaymentSuccess({
  paymentId,
  receiptNumber,
  amount,
  currency,
  stillOwes,
  remainder,
  tenantEmail,
  tenantPhone,
  onClose,
}: {
  paymentId: string;
  receiptNumber: number;
  amount: number;
  currency: string;
  stillOwes: number;
  remainder: number;
  tenantEmail: string | null;
  tenantPhone: string | null;
  onClose: () => void;
}) {
  const { download, pending: pdfPending } = useReceiptPdf();
  const { send, pending: mailPending } = useReceiptEmail();
  const [mailedTo, setMailedTo] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);

  return (
    <div className="space-y-5 py-1">
      <div className="text-center">
        <div className="mx-auto size-14 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center animate-scale-in">
          <Check size={28} strokeWidth={2.5} />
        </div>
        <p className="mt-3 text-lg font-semibold">Cobro registrado</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Recibo N° <span className="font-mono font-medium text-foreground">{formatReceiptNumber(receiptNumber)}</span> por{" "}
          <span className="font-medium text-foreground tabular-nums">{formatMoney(amount, currency)}</span>
        </p>
        <p
          className={cn(
            "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
            stillOwes > 0.004 ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {stillOwes > 0.004
            ? `Queda debiendo ${formatMoney(stillOwes, currency)}`
            : remainder > 0.004
              ? `Quedó un saldo a favor de ${formatMoney(remainder, currency)}`
              : "Quedó al día"}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ActionTile icon={<Download size={16} />} title="Descargar PDF" hint="Recibo listo para imprimir" onClick={() => download(paymentId)} pending={pdfPending} />
        <ActionTile
          icon={<Mail size={16} />}
          title={mailedTo ? "Enviado" : "Enviar por mail"}
          hint={mailedTo ?? tenantEmail ?? "El inquilino no tiene mail"}
          onClick={() => send(paymentId, setMailedTo)}
          pending={mailPending}
          disabled={!tenantEmail}
          done={!!mailedTo}
        />
        <ActionTile
          icon={<MessageCircle size={16} />}
          title="WhatsApp"
          hint={tenantPhone ? "Copiá el mensaje y abrí el chat" : "Copiá el mensaje"}
          onClick={() => setWaOpen(true)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onClose} className="min-w-28">
          Listo
        </Button>
      </div>

      <WhatsappMessageDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title="Recibo por WhatsApp"
        description="Revisalo, copialo y pegalo en el chat del inquilino."
        load={() => getReceiptWhatsapp(paymentId)}
      />
    </div>
  );
}
