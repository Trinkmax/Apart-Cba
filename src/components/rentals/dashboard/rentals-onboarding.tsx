import Link from "next/link";
import { ArrowRight, Building2, FileSignature, HandCoins, Landmark, TrendingUp, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RENTALS_ACCENT } from "@/components/rentals/ui";

/**
 * Primer uso del módulo (todavía no hay contratos): qué resuelve y los tres
 * pasos para cargar el primero. Nada de "no hay datos": un camino.
 */

const STEPS = [
  {
    icon: Building2,
    title: "La propiedad y sus dueños",
    body: "Dirección, tipo, servicios (EPEC, Ecogas, Aguas) y quién es el dueño con su porcentaje. Los propietarios que ya tenés en el panel se reutilizan.",
    href: "/dashboard/alquileres/propiedades",
    cta: "Ver propiedades",
  },
  {
    icon: UserRound,
    title: "Inquilino y garantes",
    body: "Datos de contacto para avisos y recibos, y la garantía de cada garante (propietaria, recibo de sueldo, seguro de caución…).",
    href: "/dashboard/alquileres/personas",
    cta: "Ver personas",
  },
  {
    icon: FileSignature,
    title: "Condiciones e índice",
    body: "Plazo, alquiler inicial, índice y frecuencia (IPC trimestral es lo más común), punitorios, honorarios y depósito. Te mostramos el cronograma con datos reales.",
    href: "/dashboard/alquileres/contratos/nuevo",
    cta: "Empezar el contrato",
  },
];

const PERKS = [
  { icon: TrendingUp, title: "Ajustes solos", body: "Cuando INDEC o el BCRA publican, el alquiler nuevo se calcula y te avisamos." },
  { icon: HandCoins, title: "Cobranza clara", body: "Lo que debe cada inquilino, punitorios por mora y recibos con número." },
  { icon: Landmark, title: "Rendiciones", body: "Lo cobrado menos honorarios y gastos, listo para transferir al propietario." },
];

export function RentalsOnboarding({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden gap-0 p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-[0.12] blur-3xl"
          style={{ backgroundColor: RENTALS_ACCENT }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: RENTALS_ACCENT }}>
          Alquileres tradicionales
        </p>
        <h2 className="mt-1.5 max-w-xl text-xl sm:text-2xl font-semibold tracking-tight">
          Todos tus contratos de 2 y 3 años, al día y sin planillas.
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Cargá un contrato y el panel se encarga del resto: genera lo que debe pagar el inquilino cada mes, aplica los
          ajustes por IPC o ICL cuando salen y arma la rendición para el propietario.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {PERKS.map((p) => (
            <div key={p.title} className="flex gap-3 rounded-lg border bg-background/60 p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ color: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}18` }}>
                <p.icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
        {canCreate && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/dashboard/alquileres/contratos/nuevo">
                Cargar el primer contrato <ArrowRight size={16} />
              </Link>
            </Button>
            <Link href="/dashboard/alquileres/ajustes" className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
              o probá la calculadora de ajustes
            </Link>
          </div>
        )}
      </Card>

      <Card className="gap-0 border-dashed p-5 sm:p-6">
        <p className="text-sm font-semibold">Cómo se carga un contrato</p>
        <ol className="mt-4 grid gap-5 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 sm:flex-col sm:gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums" style={{ color: RENTALS_ACCENT, backgroundColor: `${RENTALS_ACCENT}18` }}>
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium leading-snug">
                  <s.icon size={14} className="shrink-0 text-muted-foreground" /> {s.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                <Link href={s.href} className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium hover:underline" style={{ color: RENTALS_ACCENT }}>
                  {s.cta} <ArrowRight size={12} />
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
