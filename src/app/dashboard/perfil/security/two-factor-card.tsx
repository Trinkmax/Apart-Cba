"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shield, ShieldCheck } from "lucide-react";
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
import { TwoFactorWizard } from "./two-factor-wizard";
import { regenerateRecoveryCodes, disable2fa } from "@/lib/actions/security";

interface Props {
  enrolled: boolean;
  enabledAt: string | null;
}

export function TwoFactorCard({ enrolled, enabledAt }: Props) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  return (
    <section className="rounded-lg border bg-card p-6 space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {enrolled ? <ShieldCheck size={14} className="text-emerald-600" /> : <Shield size={14} />}
            Verificación en dos pasos
          </h3>
          <p className="text-sm text-muted-foreground">
            {enrolled
              ? `Activa desde ${enabledAt ? new Date(enabledAt).toLocaleDateString("es-AR") : "—"}.`
              : "Agregá un código de 6 dígitos generado por tu app de autenticación al login."}
          </p>
        </div>
        {!enrolled && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>Activar 2FA</Button>
        )}
      </header>

      {enrolled && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => setRegenOpen(true)}>
            Generar nuevos códigos de recuperación
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDisableOpen(true)} className="text-destructive">
            Desactivar 2FA
          </Button>
        </div>
      )}

      <TwoFactorWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSuccess={() => router.refresh()}
      />

      <RegenerateDialog open={regenOpen} onOpenChange={setRegenOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </section>
  );
}

function RegenerateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pwd, setPwd] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await regenerateRecoveryCodes({ currentPassword: pwd });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      setCodes(result.codes);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPwd(""); setCodes(null); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar nuevos códigos de recuperación</DialogTitle>
          <DialogDescription>
            Esto invalida los códigos anteriores. Vas a ver 8 nuevos — guardalos.
          </DialogDescription>
        </DialogHeader>
        {!codes && (
          <form onSubmit={handleGenerate} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rg_pwd">Contraseña actual</Label>
              <Input id="rg_pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Generar
              </Button>
            </DialogFooter>
          </form>
        )}
        {codes && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {codes.map((c) => (
                <div key={c} className="rounded bg-muted px-3 py-2 text-center">{c}</div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Listo</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await disable2fa({ currentPassword: pwd, totpCode: code });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success("2FA desactivado");
      onOpenChange(false);
      setPwd("");
      setCode("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPwd(""); setCode(""); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Desactivar 2FA</DialogTitle>
          <DialogDescription>
            Vas a poder entrar con solo tu contraseña. Te recomendamos mantener 2FA activo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleDisable} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="d_pwd">Contraseña actual</Label>
            <Input id="d_pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d_code">Código TOTP actual (6 dígitos)</Label>
            <Input id="d_code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required className="font-mono text-center tracking-widest" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={isPending || code.length !== 6}>
              {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              Desactivar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
