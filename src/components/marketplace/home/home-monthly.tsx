import Link from "next/link";
import { ArrowRight, Briefcase, GraduationCap, Mail, MessageCircle, Stethoscope } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ArcBand, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";

const REASONS = [
  { icon: Briefcase, title: "Trabajo", body: "Proyectos, rotaciones y traslados." },
  { icon: GraduationCap, title: "Estudio", body: "Cursadas, residencias y posgrados." },
  { icon: Stethoscope, title: "Salud", body: "Tratamientos y acompañamientos." },
];

/**
 * "¿Venís por más tiempo?" (sección forest). Las estadías de 28+ noches no se
 * piden por la web: se consultan (contrato, depósito y forma de pago).
 */
export function HomeMonthly({
  monthlyCount,
  whatsappUrl,
  mailtoUrl = null,
}: {
  monthlyCount: number;
  whatsappUrl: string | null;
  /** Consulta por mail si no hay WhatsApp configurado. */
  mailtoUrl?: string | null;
}) {
  if (monthlyCount <= 0) return null;
  const consultClass =
    "border border-cream/35 text-cream hover:bg-cream/10 focus-visible:ring-leaf-300/50 focus-visible:ring-offset-forest-700";

  return (
    <section className="px-2 sm:px-4 lg:px-6">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] bg-forest-700 px-5 py-14 text-cream sm:rounded-[2.5rem] sm:px-10 sm:py-20 lg:px-14 lg:py-24">
        <ArcBand thickness={12} className="absolute -bottom-6 -right-16 w-72 text-leaf-300/25 sm:w-96 lg:-right-10 lg:w-[30rem]" />
        <span aria-hidden className="absolute right-[12%] top-10 hidden size-4 rounded-full bg-coral-500 lg:block" />

        <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
          <Reveal>
            <Eyebrow className="text-leaf-300">Estadías por mes</Eyebrow>
            <h2 className="mt-3 font-apart text-[2rem] font-extrabold leading-[1.06] tracking-[-0.025em] text-cream text-balance sm:text-[2.5rem] lg:text-[3rem]">
              ¿Venís por más tiempo?
            </h2>
            <p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-cream/85">
              Para trabajo, estudio o tratamientos: departamentos amoblados por meses, con atención directa.
            </p>

            <p className="mt-8 flex items-baseline gap-3">
              <span className="font-apart-serif text-6xl italic leading-none text-leaf-300 tabular-nums sm:text-7xl">
                {monthlyCount}
              </span>
              <span className="max-w-[14rem] text-[0.9375rem] font-semibold leading-snug text-cream/90">
                {monthlyCount === 1 ? "departamento acepta" : "departamentos aceptan"} estadías de un mes o más
              </span>
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <ApartButton asChild variant="inverse" size="lg">
                <Link href="/buscar?modo=mes">
                  Ver estadías por mes
                  <ArrowRight aria-hidden />
                </Link>
              </ApartButton>
              {whatsappUrl ? (
                <ApartButton asChild variant="ghost" size="lg" className={consultClass}>
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle aria-hidden />
                    Consultar por WhatsApp
                  </a>
                </ApartButton>
              ) : mailtoUrl ? (
                <ApartButton asChild variant="ghost" size="lg" className={consultClass}>
                  <a href={mailtoUrl}>
                    <Mail aria-hidden />
                    Consultar por mail
                  </a>
                </ApartButton>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-cream/80">Te pasamos el precio por mes, el contrato y cómo se paga.</p>
          </Reveal>

          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 lg:gap-4">
            {REASONS.map((r, i) => (
              <Reveal as="li" key={r.title} delay={120 + i * 90} y={16}>
                <div className="flex items-center gap-4 rounded-3xl bg-forest-800/70 p-4 ring-1 ring-inset ring-cream/10 sm:flex-col sm:items-start lg:flex-row lg:items-center lg:p-5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-t-full rounded-b-lg bg-leaf-300 text-forest-700">
                    <r.icon className="size-5" strokeWidth={1.9} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-base font-extrabold text-cream">{r.title}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-cream/75">{r.body}</span>
                  </span>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
