import Link from "next/link";
import { Users, Sparkles, Send, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Primer contacto con Liquidaciones: sin ninguna generada, la lista vacía no
 * decía qué hacía falta hacer antes (asignar dueños a las unidades) ni qué
 * entra en cada mes. Tres pasos, compactos, en el lenguaje de la página.
 */
export function SettlementsOnboarding() {
  const steps = [
    {
      icon: Users,
      title: "Asigná el propietario de cada unidad",
      body: (
        <>
          La liquidación se arma por dueño: sin propietario asignado, la unidad
          no entra.{" "}
          <Link
            href="/dashboard/propietarios"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Ir a Propietarios
            <ArrowUpRight size={12} />
          </Link>
        </>
      ),
    },
    {
      icon: Sparkles,
      title: "Generá la liquidación del mes",
      body: (
        <>
          Elegís propietario y mes. Entra lo que hizo check-out ese mes (las
          mensuales se prorratean por días), más mantenimientos y gastos a su
          cargo.
        </>
      ),
    },
    {
      icon: Send,
      title: "Revisala, mandásela y registrá el pago",
      body: (
        <>
          Ajustá lo que haga falta, enviala por email o link público y marcá el
          pago: queda impactado en Caja.
        </>
      ),
    },
  ];

  return (
    <Card className="p-5 sm:p-6 border-dashed">
      <div className="mb-4">
        <p className="text-sm font-semibold">Cómo funciona</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Todavía no hay liquidaciones. Tres pasos para la primera:
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2.5">
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <Icon size={15} className="text-muted-foreground sm:hidden" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug flex items-center gap-1.5">
                  <Icon size={14} className="hidden sm:block text-muted-foreground shrink-0" />
                  {s.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
