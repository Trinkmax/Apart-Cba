"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Gavel, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { buildIntimationText } from "@/lib/actions/rentals-contracts";

/**
 * Intimación por falta de pago (art. 1222 CCyC): el texto de la carta
 * documento con la deuda al día, editable y listo para copiar.
 */

// hasLateFee: si el contrato pacta punitorios (si no, la carta reclama el interés moratorio legal).
type Loaded = { text: string; total: number; currency: string; count: number; guarantors: string[]; hasLateFee?: boolean };

export function IntimationDialog({ contractId, open, onOpenChange }: { contractId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const res = await buildIntimationText(contractId);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setData(null);
        return;
      }
      setError(null);
      setData(res);
      setText(res.text);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contractId]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado", { description: "Pegalo en el formulario de carta documento o mandáselo al estudio." });
    } catch {
      toast.error("No se pudo copiar", { description: "Seleccioná el texto y copialo a mano." });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center">
              <Gavel size={16} />
            </span>
            Intimación por falta de pago
          </DialogTitle>
          <DialogDescription>
            Antes de un desalojo hay que intimar de forma fehaciente con 10 días corridos para pagar e indicando dónde (art. 1222 CCyC).
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{error}</div>
        ) : !data ? (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Armando el texto con la deuda al día…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-sm">
              <span>
                Deuda vencida: <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(data.total, data.currency)}</span>
              </span>
              <span className="text-muted-foreground">
                {data.count} cargo{data.count === 1 ? "" : "s"}
                {data.guarantors.length ? ` · copia a ${data.guarantors.length} garante${data.guarantors.length === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[22rem] text-[13px] leading-relaxed font-mono" aria-label="Texto de la intimación" />
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info size={13} className="mt-0.5 shrink-0" />
              Para que valga, mandala por carta documento (Correo Argentino) al domicilio del contrato: una al inquilino y una a cada garante.
              {data.hasLateFee ? " Los punitorios se calculan al día del pago." : ""}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={() => void copyText()} disabled={!data} className="gap-2">
            <Copy size={14} /> Copiar texto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
