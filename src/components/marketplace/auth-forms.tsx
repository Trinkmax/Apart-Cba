"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  signInGuest,
  signUpGuest,
  requestGuestPasswordReset,
} from "@/lib/actions/guest-auth";

export function GuestSignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") ?? "/mi-cuenta";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await signInGuest({ email, password });
      if (!result.ok) {
        toast.error("No pudimos iniciar sesión", { description: result.error });
        return;
      }
      toast.success("¡Bienvenido!");
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-neutral-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
          placeholder="tu@email.com"
          disabled={isPending}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-neutral-700">
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPwd ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 pr-10 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
            placeholder="••••••••"
            disabled={isPending}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
          >
            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full h-12 rounded-xl bg-gradient-to-r from-sage-500 to-sage-600 text-white font-medium shadow-sm hover:shadow-md hover:from-sage-600 hover:to-sage-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : null}
        Continuar
      </button>

      <div className="text-center pt-2">
        <button
          type="button"
          className="text-sm text-neutral-600 hover:underline underline-offset-4"
          onClick={async () => {
            if (!email) {
              toast.info("Escribí tu email primero");
              return;
            }
            const r = await requestGuestPasswordReset(email);
            if (r.ok) {
              toast.success("Te enviamos un email para recuperar la contraseña");
            } else {
              toast.error(r.error);
            }
          }}
        >
          Olvidé mi contraseña
        </button>
      </div>

      <div className="text-center pt-3 text-sm text-neutral-600">
        ¿Sos nuevo?{" "}
        <Link href="/registrarse" className="font-medium text-neutral-900 hover:underline underline-offset-4">
          Crear cuenta
        </Link>
      </div>
    </form>
  );
}

export function GuestSignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") ?? "/mi-cuenta";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await signUpGuest({
        email,
        password,
        full_name: fullName,
        phone,
        marketing_consent: marketing,
      });
      if (!result.ok) {
        toast.error("No pudimos crear la cuenta", { description: result.error });
        return;
      }
      // Auto-login
      const signed = await signInGuest({ email, password });
      if (signed.ok) {
        toast.success("¡Bienvenido a rentOS!");
        router.push(redirectTo);
        router.refresh();
      } else {
        toast.success("Cuenta creada. Iniciá sesión.");
        router.push(`/ingresar?redirect=${encodeURIComponent(redirectTo)}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">Nombre completo</label>
        <input
          type="text"
          required
          autoFocus
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
          placeholder="María González"
          disabled={isPending}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
          placeholder="tu@email.com"
          disabled={isPending}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">Teléfono</label>
        <input
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full h-12 px-4 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
          placeholder="+54 9 351 ..."
          disabled={isPending}
        />
        <div className="text-xs text-neutral-500">
          Lo usamos sólo para coordinar la estadía con el anfitrión.
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">Contraseña</label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-12 px-4 pr-10 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 outline-none transition-colors"
            placeholder="Mínimo 8 caracteres"
            disabled={isPending}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
          >
            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-neutral-300"
        />
        <span className="text-sm text-neutral-600 leading-relaxed">
          Quiero recibir novedades, ofertas exclusivas y consejos para mis viajes.
        </span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="w-full h-12 rounded-xl bg-gradient-to-r from-sage-500 to-sage-600 text-white font-medium shadow-sm hover:shadow-md hover:from-sage-600 hover:to-sage-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : null}
        Crear mi cuenta
      </button>

      <p className="text-xs text-neutral-500 text-center leading-relaxed">
        Al continuar aceptás los{" "}
        <Link href="/legal/terminos" className="underline underline-offset-2">
          Términos
        </Link>{" "}
        y la{" "}
        <Link href="/legal/privacidad" className="underline underline-offset-2">
          Política de Privacidad
        </Link>
        .
      </p>

      <div className="text-center pt-3 text-sm text-neutral-600">
        ¿Ya tenés cuenta?{" "}
        <Link href="/ingresar" className="font-medium text-neutral-900 hover:underline underline-offset-4">
          Ingresar
        </Link>
      </div>
    </form>
  );
}
