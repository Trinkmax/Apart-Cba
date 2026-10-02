"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseAmountInput } from "@/lib/format";
import { uploadTenantProof } from "@/lib/actions/rentals-portal";
import type { RentalServiceKind } from "@/lib/types/database";
import { ProofFilePicker } from "@/components/rentals/proofs/proof-file-picker";
import type { PreparedProofFile } from "@/components/rentals/proofs/prepare-file";
import { readableTextOn } from "./portal-helpers";

/**
 * Subir (o reemplazar) el comprobante de un servicio desde el portal. Se abre
 * debajo del renglón: elegir foto/PDF, importe opcional y enviar.
 */
export function PortalProofUpload({
  token,
  kind,
  period,
  label,
  replace,
  brandColor,
}: {
  token: string;
  kind: RentalServiceKind;
  period: string;
  /** "Expensas de octubre" (para el botón y el aviso). */
  label: string;
  /** Ya hay uno en revisión: el botón dice "Cambiar". */
  replace?: boolean;
  brandColor: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<PreparedProofFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fg = readableTextOn(brandColor);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileError("Elegí la foto o el PDF del comprobante.");
      return;
    }
    const text = amount.trim();
    if (text && parseAmountInput(text) == null) {
      setAmountError("Escribí el importe como 45.000 o 45.000,50.");
      return;
    }
    const fd = new FormData();
    fd.set("token", token);
    fd.set("kind", kind);
    fd.set("period", period);
    fd.set("amount", text);
    fd.set("file", file.file, file.file.name);
    startTransition(async () => {
      const res = await uploadTenantProof(fd);
      if (!res.ok) {
        if (res.field === "file") setFileError(res.error);
        else if (res.field === "amount") setAmountError(res.error);
        toast.error("No se pudo enviar", { description: res.error });
        return;
      }
      toast.success("¡Listo! Recibimos el comprobante", { description: "Lo revisamos y, si falta algo, te avisamos." });
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      setFile(null);
      setAmount("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={replace ? "outline" : "default"}
        className="h-10 gap-1.5 px-3.5"
        style={replace ? undefined : { backgroundColor: brandColor, color: fg }}
        onClick={() => setOpen(true)}
        aria-label={`${replace ? "Cambiar" : "Subir"} comprobante: ${label}`}
      >
        {replace ? <RefreshCw size={15} /> : <Camera size={15} />}
        {replace ? "Cambiar" : "Subir"}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 w-full basis-full space-y-3 rounded-xl border bg-muted/30 p-3 animate-fade-in">
      <ProofFilePicker
        value={file}
        onChange={setFile}
        error={fileError}
        onError={setFileError}
        disabled={pending}
        label="Elegir foto o PDF"
        hint="Sacale una foto al comprobante pago (hasta 4 MB)"
      />
      <div className="space-y-1.5">
        <Label htmlFor={`amount-${kind}-${period}`} className="text-xs">
          Importe pagado <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={`amount-${kind}-${period}`}
          type="text"
          inputMode="decimal"
          placeholder="0,00"
          className="h-11 text-base tabular-nums"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(null);
          }}
          aria-invalid={!!amountError}
        />
        {amountError && <p className="text-xs font-medium text-rose-700">{amountError}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="h-11 flex-1 gap-2" style={{ backgroundColor: brandColor, color: fg }}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {pending ? "Enviando…" : "Enviar comprobante"}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
