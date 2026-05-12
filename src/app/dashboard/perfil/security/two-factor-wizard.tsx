"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { enrollMfaFactor, verifyMfaEnrollment } from "@/lib/actions/security";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = "qr" | "verify" | "codes";

export function TwoFactorWizard({ open, onOpenChange, onSuccess }: Props) {
  const [step, setStep] = useState<Step>("qr");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next && !factorId) {
      startTransition(async () => {
        const result = await enrollMfaFactor();
        if (!result.ok) {
          toast.error("Error", { description: result.error });
          onOpenChange(false);
          return;
        }
        setFactorId(result.factorId);
        setQrCode(result.qrCode);
        setSecret(result.secret);
      });
    }
    onOpenChange(next);
    if (!next) {
      setStep("qr");
      setFactorId(null);
      setQrCode(null);
      setSecret(null);
      setCode("");
      setRecoveryCodes([]);
    }
  }

  function handleVerify() {
    if (!factorId) return;
    startTransition(async () => {
      const result = await verifyMfaEnrollment({ factorId, code });
      if (!result.ok) {
        toast.error("Código incorrecto", { description: result.error });
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setStep("codes");
    });
  }

  function handleCopySecret() {
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1500);
  }

  function handleCopyAllCodes() {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  function handleDownloadCodes() {
    const blob = new Blob(
      [`rentOS — Códigos de recuperación 2FA\nGenerados: ${new Date().toLocaleString("es-AR")}\n\n${recoveryCodes.join("\n")}\n\nCada código es de un solo uso.`],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apartcba-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFinish() {
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activar verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {step === "qr" && "Escaneá el QR con tu app de autenticación (Authy, Google Authenticator, 1Password)."}
            {step === "verify" && "Ingresá el código de 6 dígitos que muestra tu app."}
            {step === "codes" && "Guardá estos códigos en un lugar seguro. No los vamos a volver a mostrar."}
          </DialogDescription>
        </DialogHeader>

        {step === "qr" && (
          <div className="space-y-3">
            {qrCode ? (
              <>
                <div className="rounded-md border p-4 flex justify-center bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCode} alt="QR 2FA" width={200} height={200} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">¿No podés escanear? Copiá este código manualmente:</Label>
                  <div className="flex items-center gap-2">
                    <Input value={secret ?? ""} readOnly className="font-mono text-xs" />
                    <Button type="button" size="icon" variant="ghost" onClick={handleCopySecret}>
                      {copiedSecret ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => setStep("verify")}>Siguiente →</Button>
                </DialogFooter>
              </>
            ) : (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="totp_code">Código de 6 dígitos</Label>
              <Input
                id="totp_code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                autoFocus
                className="text-center tracking-widest font-mono text-lg"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("qr")}>← Atrás</Button>
              <Button onClick={handleVerify} disabled={code.length !== 6 || isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Verificar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "codes" && (
          <div className="space-y-3">
            <div className="rounded-md border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 p-3 flex items-start gap-2">
              <Shield size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Guardá estos códigos AHORA.</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">No los vamos a volver a mostrar. Si perdés el dispositivo Y los códigos, vas a tener que contactar al admin para resetear 2FA.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <div key={c} className="rounded bg-muted px-3 py-2 text-center">{c}</div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleCopyAllCodes}>
                {copiedAll ? <Check size={14} className="mr-1.5 text-emerald-600" /> : <Copy size={14} className="mr-1.5" />}
                Copiar todos
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleDownloadCodes}>
                Descargar .txt
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={handleFinish}>Listo, los guardé</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
