import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/lib/actions/auth";

export default function SinAccesoPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <Logo size="lg" />
      <div className="mt-12 space-y-3 max-w-md animate-fade-up">
        <div className="size-16 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-2xl font-semibold">Sin acceso</h1>
        <p className="text-muted-foreground text-sm">
          Tu cuenta existe pero todavía no fue asignada a ninguna organización.
          Pedile a un administrador que te invite.
        </p>
      </div>
      <form action={signOut} className="mt-8">
        <Button type="submit" variant="outline">Cerrar sesión</Button>
      </form>
      <Link href="/login" className="text-xs text-muted-foreground mt-4 hover:text-foreground">
        Volver al login
      </Link>
    </div>
  );
}
