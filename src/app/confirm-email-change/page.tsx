import Link from "next/link";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmEmailChange } from "@/lib/actions/security";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ConfirmEmailChangePage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token) {
    return <ResultPanel kind="error" message="Falta el token en el link." />;
  }
  const result = await confirmEmailChange(token);
  if (!result.ok) {
    return <ResultPanel kind="error" message={result.error} />;
  }
  return (
    <ResultPanel
      kind="success"
      message={`Tu email fue actualizado a ${result.newEmail}. Cerramos tu sesión actual; volvé a entrar con el nuevo email.`}
    />
  );
}

function ResultPanel({ kind, message }: { kind: "success" | "error"; message: string }) {
  const Icon = kind === "success" ? CheckCircle2 : AlertTriangle;
  const color = kind === "success" ? "text-emerald-600" : "text-destructive";
  return (
    <main className="min-h-svh flex items-center justify-center px-4 py-10 bg-muted/40">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center space-y-4">
        <Icon size={48} className={`mx-auto ${color}`} />
        <h1 className="text-xl font-semibold">
          {kind === "success" ? "Email actualizado" : "No pudimos confirmar"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild>
          <Link href="/login">Ir al login</Link>
        </Button>
      </div>
    </main>
  );
}
