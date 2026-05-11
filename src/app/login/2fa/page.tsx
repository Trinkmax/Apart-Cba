import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { TotpForm } from "./totp-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ factorId?: string }>;
}

export default async function TwoFactorLoginPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { factorId } = await searchParams;
  if (!factorId) redirect("/login");

  return (
    <main className="min-h-svh flex items-center justify-center px-4 py-10 bg-muted/40">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-semibold">Verificación en dos pasos</h1>
          <p className="text-sm text-muted-foreground">
            Ingresá el código de 6 dígitos que muestra tu app de autenticación.
          </p>
        </header>
        <TotpForm factorId={factorId} />
      </div>
    </main>
  );
}
