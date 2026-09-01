"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/actions/auth";

/**
 * Supabase Auth devuelve sus errores en inglés y sin contexto ("Invalid login
 * credentials"): acá se traducen a algo que la persona pueda accionar sola —
 * el staff no tiene recuperación por email, la contraseña la regenera su admin.
 * Los mensajes que ya vienen en castellano son nuestros (los arma `signIn`) y
 * pasan derecho.
 */
function loginErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (raw === "Esta cuenta no está habilitada para rentOS.") return raw;
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "Email o contraseña incorrectos. Si perdiste la contraseña, pedile al administrador que te la regenere.";
  }
  if (m.includes("email not confirmed")) {
    return "Tu cuenta todavía no está confirmada. Avisale al administrador.";
  }
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("for security purposes")) {
    return "Demasiados intentos. Esperá un minuto y probá de nuevo.";
  }
  return "No pudimos entrar con esos datos. Probá de nuevo en un momento y, si sigue, avisale al administrador.";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await signIn(email, password);
      if (result.error) {
        toast.error("No se pudo iniciar sesión", {
          description: loginErrorMessage(result.error),
        });
        return;
      }
      if (result.requiresMfa) {
        router.push(`/login/2fa?factorId=${result.requiresMfa.factorId}`);
        return;
      }
      toast.success("Sesión iniciada");
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="tu@rentos.app"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          disabled={isPending}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Contraseña</Label>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={isPending}
            className="h-11 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={isPending} className="w-full h-11 mt-2">
        {isPending ? (
          <>
            <Loader2 className="animate-spin" />
            Ingresando…
          </>
        ) : (
          <>
            <LogIn />
            Ingresar
          </>
        )}
      </Button>
    </form>
  );
}
