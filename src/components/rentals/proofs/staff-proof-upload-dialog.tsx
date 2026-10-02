"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseAmountInput } from "@/lib/format";
import { monthLabelOf } from "@/lib/rentals/labels";
import { uploadProofFromStaff } from "@/lib/actions/rentals-proofs";
import type { RentalServiceKind } from "@/lib/types/database";
import { KindChip, kindLabel } from "./proof-kind-icon";
import { PROOF_KIND_ORDER } from "./proof-helpers";
import { ProofFilePicker } from "./proof-file-picker";
import type { PreparedProofFile } from "./prepare-file";

/**
 * "Subir yo": alguien del equipo carga el comprobante que le llegó por otro
 * lado. Por defecto queda validado (ya lo miró); destildando queda en la cola.
 */
export function StaffProofUploadDialog({
  contractId,
  currency,
  period,
  monthChoices,
  kinds,
  defaultKind,
  tenantName,
  children,
  onUploaded,
}: {
  contractId: string;
  currency: string;
  /** Mes inicial (YYYY-MM-01). */
  period: string;
  /** Si viene, deja elegir entre estos meses. */
  monthChoices?: string[];
  /** Tipos para elegir (default: todos). */
  kinds?: RentalServiceKind[];
  defaultKind?: RentalServiceKind;
  tenantName?: string | null;
  children: ReactNode;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const options = kinds?.length ? kinds : PROOF_KIND_ORDER;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<RentalServiceKind>(defaultKind ?? options[0]);
  const [month, setMonth] = useState(period);
  const [file, setFile] = useState<PreparedProofFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [validate, setValidate] = useState(true);
  const [note, setNote] = useState("");

  function reset() {
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    setFile(null);
    setFileError(null);
    setAmount("");
    setNote("");
    setValidate(true);
    setKind(defaultKind ?? options[0]);
    setMonth(period);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileError("Elegí el archivo del comprobante.");
      return;
    }
    const text = amount.trim();
    if (text && (parseAmountInput(text) == null || (parseAmountInput(text) ?? 0) < 0)) {
      toast.error("Revisá el importe", { description: "Escribilo como 45.000 o 45.000,50." });
      return;
    }
    const fd = new FormData();
    fd.set("contractId", contractId);
    fd.set("kind", kind);
    fd.set("period", month);
    fd.set("amount", text);
    fd.set("validate", validate ? "1" : "0");
    fd.set("note", note.trim());
    fd.set("file", file.file, file.file.name);
    startTransition(async () => {
      const res = await uploadProofFromStaff(fd);
      if (!res.ok) {
        if (res.field === "file") setFileError(res.error);
        toast.error("No se pudo subir el comprobante", { description: res.error });
        return;
      }
      toast.success(validate ? "Comprobante cargado y validado" : "Comprobante cargado: quedó para revisar", {
        description: `${kindLabel(kind)} · ${monthLabelOf(month)}`,
      });
      reset();
      setOpen(false);
      onUploaded?.();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && pending) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Upload size={16} />
            </span>
            Subir comprobante
          </DialogTitle>
          <DialogDescription>
            {tenantName ? `De ${tenantName}. ` : ""}Para cuando te lo mandan por WhatsApp, mail o en mano.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Qué comprobante</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RentalServiceKind)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((k) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <KindChip kind={k} size="sm" className="size-5 rounded" />
                        {kindLabel(k)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Mes</Label>
              {monthChoices?.length ? (
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthChoices.map((m) => (
                      <SelectItem key={m} value={m}>
                        {monthLabelOf(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{monthLabelOf(month)}</div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Archivo</Label>
            <ProofFilePicker value={file} onChange={setFile} error={fileError} onError={setFileError} disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-proof-amount">Importe ({currency})</Label>
            <Input
              id="staff-proof-amount"
              type="text"
              inputMode="decimal"
              placeholder="Opcional · 0,00"
              className="h-10 text-lg tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-proof-note">Nota</Label>
            <Textarea id="staff-proof-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
            <Checkbox checked={validate} onCheckedChange={(v) => setValidate(v === true)} className="mt-0.5" />
            <span className="text-sm leading-snug">
              <span className="font-medium">Ya lo revisé: queda validado</span>
              <span className="block text-xs text-muted-foreground">Destildalo si querés que pase por la cola de revisión.</span>
            </span>
          </label>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Subir comprobante
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
