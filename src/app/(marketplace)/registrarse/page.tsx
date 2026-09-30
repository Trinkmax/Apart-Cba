import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSignUpForm } from "@/components/marketplace/auth-forms";
import { AuthShell } from "@/components/marketplace/shell/auth-shell";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/components/marketplace/shell/safe-redirect";
import { getGuestSession } from "@/lib/actions/guest-auth";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Creá tu cuenta de apart para seguir tus reservas y guardar tus favoritos.",
  robots: { index: false, follow: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function RegistrarsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const redirectParam = safeRedirectPath(first(sp.redirect), "") || null;
  const redirectTo = redirectParam ?? DEFAULT_AFTER_LOGIN;

  const session = await getGuestSession();
  if (session) redirect(redirectTo);

  return (
    <AuthShell quote="Sentite como en casa.">
      <GuestSignUpForm redirectTo={redirectTo} redirectParam={redirectParam} />
    </AuthShell>
  );
}
