import Link from "next/link";
import { ArrowRight, Building2, FileSignature, Plus, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RENTALS_ACCENT } from "@/components/rentals/ui";

/**
 * Primera vez (no hay ningún contrato): en vez de "no hay nada", los 3 pasos
 * para cargar el primero, con el porqué de cada uno.
 */
const STEPS = [
  {
    icon: Building2,
    title: "Propiedad y dueños",
    body: "La dirección, el tipo y quiénes son los propietarios con su porcentaje. A ellos se les rinde lo que se cobra.",
    href: "/dashboard/alquileres/propiedades",
    cta: "Ver propiedades",
  },
  {
    icon: Users,
    title: "Inquilino y garantes",
    body: "Quién alquila (el titular de los recibos) y sus garantías. Si todavía no están cargados, los creás desde el mismo contrato.",
    href: "/dashboard/alquileres/personas",
    cta: "Ver personas",
  },
  {
    icon: TrendingUp,
    title: "Condiciones e índice",
    body: "Plazo, alquiler inicial y cómo se actualiza (IPC, ICL…). El sistema calcula cada ajuste con los índices oficiales y genera los cargos de cada mes.",
    href: "/dashboard/alquileres/contratos/nuevo",
    cta: "Cargar el contrato",
  },
];

export function ContractsOnboarding() {
  return (
    <Card className="p-5 sm:p-7 gap-6 border-dashed">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-start gap-3">
          <span
            className="size-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${RENTALS_ACCENT}18`, color: RENTALS_ACCENT }}
          >
            <FileSignature size={20} />
          </span>
          <div>
            <p className="text-base font-semibold">Cargá tu primer contrato</p>
            <p className="text-sm text-muted-foreground mt-0.5 max-w-xl">
              Con el contrato cargado, el sistema arma el cronograma de ajustes, genera lo que debe el inquilino cada mes y te avisa qué hacer.
            </p>
          </div>
        </div>
        <Button asChild className="gap-2 shrink-0">
          <Link href="/dashboard/alquileres/contratos/nuevo">
            <Plus size={16} /> Nuevo contrato
          </Link>
        </Button>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2.5 rounded-xl border bg-card p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium leading-snug flex items-center gap-1.5">
                <s.icon size={14} className="text-muted-foreground" /> {s.title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
              <Link href={s.href} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                {s.cta} <ArrowRight size={12} />
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
