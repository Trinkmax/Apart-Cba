"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAdjustmentNotice, notifyAdjustment } from "@/lib/actions/rentals-adjustments";

/**
 * Aviso del ajuste por WhatsApp: muestra el mensaje, lo copia y abre el chat
 * del inquilino. Recién al copiar o abrir se marca "avisado" (antes es sólo
 * una vista previa).
 */
export function WhatsappNoticeDialog({
  adjustmentId,
  tenantName,
  open,
  onOpenChange,
}: {
  adjustmentId: string;
  tenantName: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string; url: string | null; phone: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getAdjustmentNotice(adjustmentId).then((res) => {
      if (!alive) return;
      if (!res.ok) setError(res.error);
      else setNotice({ text: res.whatsappText, url: res.whatsappUrl, phone: res.phone });
    });
    return () => {
      alive = false;
    };
  }, [open, adjustmentId]);

  function mark() {
    if (marked) return;
    setMarked(true);
    startTransition(async () => {
      const res = await notifyAdjustment(adjustmentId, { channel: "whatsapp" });
      if (!res.ok) {
        setMarked(false);
        toast.error("No se pudo marcar como avisado", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  async function copy() {
    if (!notice) return;
    try {
      await navigator.clipboard.writeText(notice.text);
      setCopied(true);
      toast.success("Mensaje copiado", { description: "Pegalo en el chat del inquilino." });
      mark();
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setCopied(false);
          setNotice(null);
          setError(null);
          setMarked(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <MessageCircle size={16} />
            </span>
            Avisar por WhatsApp
          </DialogTitle>
          <DialogDescription>
            {tenantName ? `Mensaje para ${tenantName}.` : "Mensaje para el inquilino."} Revisalo antes de mandarlo.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>
        ) : !notice ? (
          <div className="flex h-36 items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 size={14} className="animate-spin" /> Armando el mensaje…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap select-all">
              {notice.text}
            </div>
            {!notice.url && (
              <p className="text-xs text-muted-foreground">
                {notice.phone ? "El teléfono del inquilino no parece un celular válido: copiá el mensaje y mandalo a mano." : "El inquilino no tiene teléfono cargado: copiá el mensaje y mandalo a mano."}
              </p>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" className="gap-2" onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copiado" : "Copiar mensaje"}
              </Button>
              {notice.url && (
                <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <a href={notice.url} target="_blank" rel="noopener noreferrer" onClick={mark}>
                    <ExternalLink size={14} /> Abrir WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
