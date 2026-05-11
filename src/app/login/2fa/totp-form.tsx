"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { verifyMfaLogin, useRecoveryCodeLogin as recoveryCodeLogin } from "@/lib/actions/security";

interface Props {
  factorId: string;
}

export function TotpForm({ factorId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await verifyMfaLogin({ factorId, code });
      if (!result.ok) {
        toast.error("Código incorrecto", { description: result.error });
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  function handleRecovery(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await recoveryCodeLogin({ code: recovery });
      if (!result.ok) {
        toast.error("Error", { description: result.error });
        return;
      }
      toast.success("Entraste con un código de recuperación. Te recomendamos re-activar 2FA cuanto antes.");
      router.push("/dashboard/perfil");
      router.refresh();
    });
  }

  if (mode === "recovery") {
    return (
      <form onSubmit={handleRecovery} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="rec">Código de recuperación</Label>
          <Input
            id="rec"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono text-center tracking-widest"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isPending || recovery.length < 19}>
          {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Entrar con código
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("totp")}>
          ← Usar app de autenticación
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleTotp} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="totp">Código de 6 dígitos</Label>
        <Input
          id="totp"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
          required
          className="font-mono text-center tracking-widest text-lg"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isPending || code.length !== 6}>
        {isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
        Ingresar
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("recovery")}>
        Usar un código de recuperación
      </Button>
    </form>
  );
}
