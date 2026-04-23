"use client";

import { useState, useTransition } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupFirstAdmin } from "@/lib/actions/setup";

export function SetupForm({ hasOrg, orgId }: { hasOrg: boolean; orgId: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({
    org_name: hasOrg ? "" : "Apart Cba",
    full_name: "",
    email: "",
    password: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    startTransition(async () => {
      try {
        await setupFirstAdmin({
          ...form,
          existing_org_id: orgId,
        });
        setDone(true);
        toast.success("Configuración completa");
        setTimeout(() => {
          router.push("/login");
        }, 1500);
      } catch (e) {
        toast.error("Error", { description: (e as Error).message });
      }
    });
  }

  if (done) {
    return (
      <div className="text-center py-8 space-y-3 animate-fade-up">
        <div className="size-16 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
          <CheckCircle2 size={32} />
        </div>
        <p className="font-semibold">¡Listo!</p>
        <p className="text-sm text-muted-foreground">Redirigiendo al login…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!hasOrg && (
        <div className="space-y-1.5">
          <Label>Nombre de la organización</Label>
          <Input
            required
            value={form.org_name}
            onChange={(e) => setForm({ ...form, org_name: e.target.value })}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Tu nombre completo</Label>
        <Input
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          placeholder="Juan Pérez"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="admin@apartcba.com.ar"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Contraseña (8+ caracteres)</Label>
        <Input
          required
          type="password"
          minLength={8}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={isPending} className="w-full h-11 mt-2">
        {isPending ? <Loader2 className="animate-spin" /> : null}
        Crear y entrar
      </Button>
    </form>
  );
}
