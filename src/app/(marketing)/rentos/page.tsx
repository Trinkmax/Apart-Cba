import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { PmsPreview } from "@/components/marketing/pms-preview";
import { ModulesSection } from "@/components/marketing/modules-section";
import { SettlementShowcase } from "@/components/marketing/settlement-showcase";
import { ChannelsFlow } from "@/components/marketing/channels-flow";
import { TrialForm } from "@/components/marketing/trial-form";
import { Reveal } from "@/components/marketplace/reveal";

const TITLE = "rentOS — El panel para administrar alquileres temporarios";
const DESCRIPTION =
  "Calendario, Airbnb y Booking, limpieza, caja y liquidaciones a propietarios en un solo lugar. Probalo con datos cargados, sin tarjeta.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/rentos" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/rentos",
    siteName: "rentOS",
    locale: "es_AR",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// La vista previa del calendario usa las fechas reales del mes corriente, así que
// la página se regenera cada hora. Nada acá consulta la base.
export const revalidate = 3600;

export default function RentosLandingPage() {
  return (
    <>
      <MarketingHeader />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-5 pt-14 md:px-8 md:pt-24">
          {/* Halo sage detrás del titular. Da profundidad sin meter una imagen. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-20rem] h-[38rem] w-[68rem] -translate-x-1/2 rounded-full opacity-25 blur-[130px]"
            style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 70%)" }}
          />

          <div className="relative mx-auto max-w-[1240px]">
            <h1 className="max-w-[15ch] text-[38px] font-semibold leading-[1.05] tracking-[-0.02em] md:text-[64px]">
              Tu operación entera, en una sola pantalla.
            </h1>
            <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-muted-foreground md:text-lg">
              Calendario, canales de venta, limpieza, caja y liquidaciones a propietarios.
              Lo que hoy manejás en cinco lugares distintos.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button size="lg" className="h-12 rounded-full px-7 text-[15px]" asChild>
                <a href="#probar">
                  Probar el panel
                  <ArrowRight />
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full px-6 text-[15px]"
                asChild
              >
                <a href="#modulos">Ver los módulos</a>
              </Button>
            </div>
          </div>

          {/* La grilla del PMS es el argumento: se entiende sin leer nada. */}
          <div className="relative mx-auto mt-14 max-w-[1240px] md:mt-20">
            <PmsPreview />
          </div>
        </section>

        {/* ── El problema ──────────────────────────────────────────────── */}
        <section className="px-5 py-20 md:px-8 md:py-28">
          <Reveal className="mx-auto max-w-[1240px]">
            <h2 className="max-w-[24ch] text-[28px] font-semibold leading-[1.14] tracking-tight md:text-[38px]">
              Hoy tu operación vive en cinco lugares.
            </h2>
            <p className="mt-6 max-w-[62ch] text-base leading-relaxed text-muted-foreground md:text-lg">
              La planilla de reservas, el calendario de Airbnb, el WhatsApp del encargado, la
              carpeta de comprobantes y el Excel de las liquidaciones. Ninguno se entera de lo
              que hizo el otro, y la diferencia la terminás poniendo vos.
            </p>
          </Reveal>
        </section>

        {/* ── Módulos ──────────────────────────────────────────────────── */}
        <section id="modulos" className="scroll-mt-20 px-5 pb-20 md:px-8 md:pb-28">
          <div className="mx-auto max-w-[1240px]">
            <Reveal className="max-w-[60ch]">
              <h2 className="text-[28px] font-semibold leading-[1.14] tracking-tight md:text-[38px]">
                Seis módulos, una sola base de datos.
              </h2>
              <p className="mt-5 leading-relaxed text-muted-foreground md:text-[17px]">
                Una reserva que cambia de fecha mueve la limpieza, avisa al equipo y ajusta la
                liquidación del dueño. No hay que copiar nada de un lado al otro.
              </p>
            </Reveal>

            <div className="mt-10">
              <ModulesSection />
            </div>
          </div>
        </section>

        {/* ── Liquidaciones ────────────────────────────────────────────── */}
        <section
          id="liquidaciones"
          className="scroll-mt-20 border-t border-border px-5 py-20 md:px-8 md:py-28"
        >
          <div className="mx-auto max-w-[1240px]">
            <SettlementShowcase />
          </div>
        </section>

        {/* ── Canales ──────────────────────────────────────────────────── */}
        <section
          id="canales"
          className="scroll-mt-20 border-t border-border px-5 py-20 md:px-8 md:py-28"
        >
          <div className="mx-auto max-w-[1240px]">
            <ChannelsFlow />
          </div>
        </section>

        {/* ── Alta ─────────────────────────────────────────────────────── */}
        {/* Banda teñida en sage para separar el cierre del resto de la página.
            Antes acá iba una foto de Córdoba, pero el loader de imágenes del
            proyecto es custom y sirve los assets de /public sin optimizar (311 KB
            a tamaño completo): en una landing para pautar eso se paga en LCP y no
            aportaba nada que el color no resuelva. */}
        <section
          id="probar"
          className="relative scroll-mt-20 overflow-hidden border-t border-border bg-secondary"
        >
          <div className="relative mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
              <div>
                <h2 className="max-w-[18ch] text-[30px] font-semibold leading-[1.1] tracking-tight md:text-[44px]">
                  La mejor forma de probar un sistema es usándolo.
                </h2>
                <p className="mt-6 max-w-[50ch] text-base leading-relaxed text-muted-foreground md:text-[17px]">
                  Entrás a un panel con 8 departamentos, tres meses de reservas, caja y
                  limpiezas ya cargadas. Movés una reserva, generás una liquidación y ves cómo
                  se comporta con tu forma de trabajar. Cuando quieras cargar lo tuyo, vaciás
                  los datos de ejemplo de un click.
                </p>
              </div>

              <Card className="p-6 md:p-8">
                <TrialForm />
              </Card>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
