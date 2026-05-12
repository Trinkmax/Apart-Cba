"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Mínimo 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("No se pudo cambiar la contraseña", { description: error.message });
        return;
      }
      toast.success("¡Contraseña actualizada!");
      router.push("/mi-cuenta");
    });
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12 md:py-20">
      <h1 className="text-2xl font-semibold text-neutral-900 text-center">Nueva contraseña</h1>
      <p className="text-sm text-neutral-500 text-center mt-2 mb-8">
        Elegí una contraseña segura para tu cuenta.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">Nueva contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">Confirmar</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none"
            required
            disabled={pending}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-sage-500 to-sage-600 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : null}
          Cambiar contraseña
        </button>
      </form>
    </div>
  );
}
