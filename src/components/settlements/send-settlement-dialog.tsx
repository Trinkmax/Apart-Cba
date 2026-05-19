"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendSettlementToOwner } from "@/lib/actions/settlements";

export function SendSettlementDialog({
  settlementId,
  ownerEmail,
  periodLabel,
  children,
}: {
  settlementId: string;
  ownerEmail: string | null;
  periodLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    start(async () => {
      try {
        const r = await sendSettlementToOwner(settlementId);
        toast.success("Liquidación enviada", {
          description: `Enviada a ${r.to} con Excel y PDF adjuntos.`,
        });
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error("No se pudo enviar", {
          description: (e as Error).message,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send size={18} className="text-primary" /> Enviar al propietario
          </DialogTitle>
          <DialogDescription>
            Liquidación de {periodLabel}. Se envía el Excel y el PDF adjuntos,
            más un link de solo lectura.
          </DialogDescription>
        </DialogHeader>

        {ownerEmail ? (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            Se enviará a{" "}
            <span className="font-medium">{ownerEmail}</span>
          </div>
        ) : (
          <p className="text-sm text-rose-600 dark:text-rose-400 py-2">
            El propietario no tiene email cargado. Agregalo en su ficha para
            poder enviar.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !ownerEmail}
            className="gap-2"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Enviar ahora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
