import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { getSession, getLandingPath, signOut } from "@/lib/actions/auth";

export default async function SinAccesoPage() {
  // Acá caen dos casos distintos: una cuenta sin organización (el original) y
  // gente CON equipo a la que una sección le cerró la puerta (el CRM manda a
  // limpieza/mantenimiento a esta página). Decirle al segundo que "no está en
  // ninguna organización" era mentira y asustaba: sí tiene acceso, pero no ahí.
  const session = await getSession();
  const hasTeam = !!session && session.memberships.length > 0;
  const home = hasTeam ? await getLandingPath() : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <Logo size="lg" />
      <div className="mt-12 space-y-3 max-w-md animate-fade-up">
        <div className="size-16 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-2xl font-semibold">Sin acceso</h1>
        {hasTeam ? (
          <p className="text-muted-foreground text-sm">
            Tu usuario no tiene permiso para esta sección. Si creés que deberías
            verla, pedile a un administrador que revise tu rol.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Tu cuenta existe pero todavía no fue asignada a ninguna organización.
            Pedile a un administrador que te invite.
          </p>
        )}
      </div>
      {home ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button asChild>
            <Link href={home}>Volver a mi inicio</Link>
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">Cerrar sesión</Button>
          </form>
        </div>
      ) : (
        <>
          <form action={signOut} className="mt-8">
            <Button type="submit" variant="outline">Cerrar sesión</Button>
          </form>
          <Link href="/login" className="text-xs text-muted-foreground mt-4 hover:text-foreground">
            Volver al login
          </Link>
        </>
      )}
    </div>
  );
}
