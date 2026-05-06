"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { sendParteDiario } from "@/lib/actions/parte-diario";
import type { ParteDiarioRecipient } from "@/lib/types/database";

interface SendDialogProps {
  date: string;
  recipients: ParteDiarioRecipient[];
  channelConfigured: boolean;
  templateName: string;
  alreadySent: boolean;
}

export function SendDialog({
  date,
  recipients,
  channelConfigured,
  templateName,
  alreadySent,
}: SendDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = recipients.filter((r) => r.active);
  const blockingError = !channelConfigured
    ? "Configurá el canal de WhatsApp en /dashboard/parte-diario/configuracion"
    : active.length === 0
      ? "Agregá al menos un destinatario en /dashboard/parte-diario/destinatarios"
      : null;

  const handleSend = () => {
    startTransition(async () => {
      try {
        const res = await sendParteDiario(date);
        if (res.failed === 0) {
          toast.success(`Enviado a ${res.sent} ${res.sent === 1 ? "persona" : "personas"}`);
        } else {
          toast.warning(
            `Enviado a ${res.sent}, falló en ${res.failed}`,
            { description: "Revisá los logs si persiste el problema." },
          );
        }
        setOpen(false);
      } catch (err) {
        toast.error("No se pudo enviar", { description: (err as Error).message });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Send className="size-3.5" />
          {alreadySent ? "Reenviar" : "Enviar a WhatsApp"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-emerald-500" />
            Enviar parte diario
          </DialogTitle>
          <DialogDescription>
            Se enviará el PDF a {active.length} {active.length === 1 ? "destinatario" : "destinatarios"} usando la plantilla{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-[11px]">{templateName}</code>.
          </DialogDescription>
        </DialogHeader>

        <Checklist
          items={[
            {
              ok: true,
              label: "PDF listo para subir",
              hint: "Se genera y sube al storage al confirmar",
            },
            {
              ok: channelConfigured,
              label: "Canal de WhatsApp configurado",
              hint: channelConfigured ? null : "Configuralo primero",
            },
            {
              ok: active.length > 0,
              label: `${active.length} ${active.length === 1 ? "destinatario activo" : "destinatarios activos"}`,
              hint: active.length === 0 ? "Agregá uno antes de enviar" : null,
            },
          ]}
        />

        {active.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 max-h-40 overflow-auto">
            <ul className="divide-y">
              {active.slice(0, 10).map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <Phone className="size-3 text-muted-foreground" />
                  <span className="truncate flex-1">{r.label ?? "Sin etiqueta"}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">+{r.phone}</span>
                </li>
              ))}
              {active.length > 10 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground italic text-center">
                  + {active.length - 10} más
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={pending || !!blockingError} className="gap-1.5">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar a {active.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Checklist({
  items,
}: {
  items: { ok: boolean; label: string; hint: string | null }[];
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {it.ok ? (
            <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="size-4 text-amber-500 mt-0.5 shrink-0" />
          )}
          <div className="flex-1">
            <p className={it.ok ? "text-foreground" : "text-amber-600 dark:text-amber-400"}>
              {it.label}
            </p>
            {it.hint ? <p className="text-xs text-muted-foreground">{it.hint}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
