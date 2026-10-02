"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, ChevronDown, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildReminderWhatsapp, sendPaymentReminder } from "@/lib/actions/rentals-collections";
import { cn } from "@/lib/utils";
import { Spinner, WhatsappMessageDialog } from "./whatsapp-message-dialog";

/** "Avisar": aviso de pago por mail o mensaje para WhatsApp con lo que debe y cómo pagar. */
export function ReminderMenu({
  contractId,
  tenantName,
  tenantEmail,
  size = "sm",
  variant = "outline",
  compact,
  className,
}: {
  contractId: string;
  tenantName: string;
  tenantEmail: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
  /** Sólo ícono (para filas angostas). */
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [waOpen, setWaOpen] = useState(false);

  function sendMail() {
    startTransition(async () => {
      const res = await sendPaymentReminder(contractId);
      if (!res.ok) {
        toast.error("No se pudo mandar el aviso", { description: res.error });
        return;
      }
      toast.success("Aviso enviado", { description: `Le llegó a ${res.to}.` });
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {compact ? (
            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Avisar a ${tenantName}`} className={className}>
              {pending ? <Spinner /> : <BellRing size={15} />}
            </Button>
          ) : (
            <Button variant={variant} size={size} disabled={pending} className={cn("gap-1.5", className)}>
              {pending ? <Spinner /> : <BellRing size={14} />} Avisar <ChevronDown size={13} className="opacity-60" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">Aviso de pago a {tenantName}</DropdownMenuLabel>
          <DropdownMenuItem disabled={!tenantEmail} onSelect={sendMail}>
            <Mail size={14} />
            <span className="min-w-0">
              <span className="block">Mandar por mail</span>
              <span className="block text-[11px] text-muted-foreground truncate">{tenantEmail ?? "No tiene mail cargado"}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setWaOpen(true)}>
            <MessageCircle size={14} />
            <span className="min-w-0">
              <span className="block">Mensaje para WhatsApp</span>
              <span className="block text-[11px] text-muted-foreground">Lo revisás, lo copiás y lo pegás</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WhatsappMessageDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title="Aviso de pago por WhatsApp"
        description="Con lo que debe, los vencimientos y los datos para pagar."
        load={() => buildReminderWhatsapp(contractId)}
      />
    </>
  );
}
