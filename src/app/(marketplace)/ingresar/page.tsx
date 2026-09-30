import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSignInForm } from "@/components/marketplace/auth-forms";
import { AuthShell } from "@/components/marketplace/shell/auth-shell";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/components/marketplace/shell/safe-redirect";
import { getGuestSession } from "@/lib/actions/guest-auth";

export const metadata: Metadata = {
  title: "Ingresar",
  description: "Entrá a tu cuenta de apart para ver tus reservas y favoritos.",
  robots: { index: false, follow: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function IngresarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // `?redirect` sólo si es una ruta interna segura; si no, se ignora.
  const redirectParam = safeRedirectPath(first(sp.redirect), "") || null;
  const redirectTo = redirectParam ?? DEFAULT_AFTER_LOGIN;

  const session = await getGuestSession();
  if (session) redirect(redirectTo);

  const linkError = first(sp.error) === "auth";
  const confirmed = first(sp.confirmado) === "1";
  const startInRecovery = first(sp.recuperar) === "1";

  return (
    <AuthShell quote="Qué lindo tenerte por Córdoba.">
      <GuestSignInForm
        key={`${linkError}-${confirmed}-${startInRecovery}`}
        redirectTo={redirectTo}
        redirectParam={redirectParam}
        linkError={linkError}
        confirmed={confirmed}
        startInRecovery={startInRecovery}
      />
    </AuthShell>
  );
}
