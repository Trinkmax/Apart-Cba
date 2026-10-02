"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { createStatement, previewOwnerPending } from "@/lib/actions/rentals-statements";
import { StatementDocument } from "./statement-document";
import type { StatementDocModel } from "./statement-model";

/**
 * "Generar rendición": elegís la fecha de corte, ves EXACTAMENTE el documento
 * que va a salir (vista previa del servidor) y lo generás en borrador.
 */
export function GenerateStatementDialog({
  ownerId,
  ownerName,
  currency,
  defaultCutoff,
  today,
  brandColor,
  children,
}: {
  ownerId: string;
  ownerName: string;
  currency: string;
  defaultCutoff: string;
  today: string;
  brandColor?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState(defaultCutoff);
  const [notes, setNotes] = useState("");
  const [model, setModel] = useState<StatementDocModel | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const seq = useRef(0);

  function loadPreview(nextCutoff: string) {
    const mine = ++seq.current;
    setPreviewError(null);
    startLoading(async () => {
      const res = await previewOwnerPending(ownerId, currency, nextCutoff);
      if (mine !== seq.current) return;
      if (!res.ok) {
        setModel(null);
        setPreviewError(res.error);
        return;
      }
      setModel(res.model);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setCutoff(defaultCutoff);
      setNotes("");
      loadPreview(defaultCutoff);
    }
  }

  function changeCutoff(v: string) {
    setCutoff(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) loadPreview(v);
  }

  function generate() {
    startSaving(async () => {
      const res = await createStatement({ ownerId, currency, cutoff, notes: notes.trim() || null });
      if (!res.ok) {
        toast.error("No se pudo generar la rendición", { description: res.error });
        return;
      }
      toast.success(`Rendición N° ${String(res.number).padStart(4, "0")} generada`, { description: "Quedó en borrador: revisala, emitila y mandásela al propietario." });
      setOpen(false);
      router.push(`/dashboard/alquileres/rendiciones/${res.statementId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[94dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <FileCheck2 size={16} />
            </span>
            Generar rendición · {ownerName}
          </DialogTitle>
          <DialogDescription>Entran los cobros hasta la fecha de corte que todavía no se rindieron, menos honorarios y gastos a su cargo.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="space-y-1.5">
            <label htmlFor="gen-cutoff" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Cobros hasta el
            </label>
            <Input id="gen-cutoff" type="date" value={cutoff} max={today} onChange={(e) => changeCutoff(e.target.value)} className="h-10 w-full sm:w-44" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="gen-notes" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Nota para el propietario <span className="normal-case tracking-normal">(opcional)</span>
            </label>
            <Textarea id="gen-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} maxLength={2000} placeholder="Ej.: este mes se cambió el flexible del calefón" className="min-h-10" />
          </div>
        </div>

        <div className="relative">
          {previewError ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200">{previewError}</p>
          ) : model ? (
            <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <StatementDocument model={model} brandColor={brandColor} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="h-24 rounded-xl bg-muted animate-pulse" />
              <div className="h-16 rounded-xl bg-muted animate-pulse" />
              <div className="h-40 rounded-xl bg-muted animate-pulse" />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:items-center sm:gap-2">
          {model && <p className="mr-auto text-xs text-muted-foreground">Neto: <span className="font-semibold tabular-nums text-foreground">{formatMoney(model.totals.net, currency)}</span></p>}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={generate} disabled={saving || loading || !model} className="gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Generar en borrador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
