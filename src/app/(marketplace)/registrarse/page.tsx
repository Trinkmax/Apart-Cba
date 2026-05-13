import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { GuestSignUpForm } from "@/components/marketplace/auth-forms";
import { getGuestSession } from "@/lib/actions/guest-auth";

export const metadata = {
  title: "Crear cuenta · rentOS",
};

export default async function RegistrarsePage() {
  const session = await getGuestSession();
  if (session) redirect("/mi-cuenta");

  return (
    <div className="max-w-md mx-auto px-4 py-12 md:py-20">
      <div className="text-center mb-8">
        <Link
          href="/"
          aria-label="rentOS — Inicio"
          className="inline-flex items-center justify-center transition-opacity hover:opacity-80"
        >
          <Logo size="lg" showWordmark={false} variant="dark" />
        </Link>
        <h2 className="text-2xl font-semibold mt-6 text-neutral-900 tracking-[-0.01em]">Empezá a explorar</h2>
        <p className="text-sm text-neutral-500 mt-2">
          Creá tu cuenta para reservar tu próxima estadía.
        </p>
      </div>
      <GuestSignUpForm />
    </div>
  );
}
