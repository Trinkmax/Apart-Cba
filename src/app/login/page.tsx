import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/brand/logo";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-stretch">
      {/* Panel izquierdo — Hero branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden brand-gradient">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(1_0_0/0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,oklch(0_0_0/0.25),transparent_70%)]" />

        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          <Logo size="xl" variant="light" />

          <div className="space-y-6 max-w-md animate-fade-up">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight">
              Tu operación,{" "}
              <span className="block opacity-80">en una sola pantalla.</span>
            </h1>
            <p className="text-lg text-white/80 leading-relaxed">
              Reservas, limpieza, mantenimiento, caja y liquidaciones a propietarios.
              Todo lo que necesitás para gestionar tus departamentos temporales.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {[
                "Kanban en vivo",
                "Multi-moneda",
                "Channel Manager",
                "PWA mobile",
                "Realtime",
              ].map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-white/15 text-white/90 backdrop-blur-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="text-sm text-white/60">
            © {new Date().getFullYear()} rentOS — Córdoba, Argentina
          </div>
        </div>
      </div>

      {/* Panel derecho — Form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-sm space-y-8 animate-fade-up">
          <div className="lg:hidden flex justify-center mb-4">
            <Logo size="lg" />
          </div>

          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">Bienvenido de nuevo</h2>
            <p className="text-muted-foreground text-sm">
              Iniciá sesión para gestionar tu operación.
            </p>
          </div>

          <LoginForm />

          <p className="text-xs text-muted-foreground text-center">
            ¿Problemas para entrar? Contactá al administrador del sistema.
          </p>
        </div>
      </div>
    </div>
  );
}
