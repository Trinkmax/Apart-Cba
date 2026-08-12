import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrialForm } from "@/components/marketing/trial-form";

const TITLE = "Probar rentOS — Tu panel con datos cargados en un minuto";
const DESCRIPTION =
  "Creá tu cuenta de rentOS y entrá a un panel con departamentos, reservas, caja y limpiezas ya cargadas. Sin tarjeta de crédito.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/rentos/probar" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/rentos/probar", type: "website" },
  robots: { index: false },
};

/**
 * Alta sin distracciones, para mandar tráfico de campañas directo acá.
 *
 * Dinámica a propósito: la acción lee cookies y la IP del visitante (rate limit),
 * y `next.config.ts` sólo fuerza no-store sobre /dashboard, /login y /api.
 */
export const dynamic = "force-dynamic";

const INCLUDED = [
  "8 departamentos con sus propietarios y sus porcentajes",
  "Tres meses de reservas entre Airbnb, Booking y directas",
  "Caja con movimientos, limpiezas del día y tickets abiertos",
] as const;

export default function ProbarPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1080px] flex-col px-5 py-8 md:px-8 md:py-12">
      <div className="flex items-center justify-between">
        <Link href="/rentos" aria-label="rentOS">
          <Logo brand="rentos" variant="dark" size="sm" />
        </Link>
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link href="/rentos">
            <ArrowLeft />
            Volver
          </Link>
        </Button>
      </div>

      <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h1 className="max-w-[16ch] text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">
            Tu panel, con datos adentro.
          </h1>
          <p className="mt-5 max-w-[46ch] leading-relaxed text-muted-foreground">
            No te dejamos frente a una pantalla vacía. La cuenta se crea con una operación de
            ejemplo andando, para que puedas probar el sistema haciendo lo que hacés todos los
            días.
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <Card className="gap-0 p-6 md:p-8">
          <TrialForm />
          <p className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Ingresá acá
            </Link>
            .
          </p>
        </Card>
      </div>
    </div>
  );
}
