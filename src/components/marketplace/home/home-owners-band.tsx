import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";

/**
 * Banda para dueños: "¿Tenés un departamento en Córdoba? Nosotros lo cuidamos."
 * (En teléfono va un poco más junta: py-8, gap-6 y titular de 1.5rem; desde sm/lg mandan
 * sm:text-[2.25rem], lg:py-14 y lg:gap-12, igual que antes.)
 */
export function HomeOwnersBand() {
  return (
    <section className="px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <Reveal
        y={20}
        className="relative mx-auto max-w-[1240px] overflow-hidden rounded-[2rem] bg-leaf-200 px-6 py-8 sm:px-10 sm:py-12 lg:rounded-[2.5rem] lg:px-14 lg:py-14"
      >
        <div
          aria-hidden
          className="absolute -right-10 top-8 hidden h-[130%] w-72 rounded-t-full border-[18px] border-b-0 border-leaf-300 md:block lg:right-8"
        />
        <ApartLogo
          variant="symbol"
          title={null}
          className="absolute -bottom-6 right-6 h-32 text-leaf-300/70 md:hidden"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-2xl">
            <Eyebrow>Propietarios</Eyebrow>
            <h2 className="mt-3 font-apart text-[1.5rem] font-extrabold leading-[1.08] tracking-[-0.025em] text-forest-700 text-balance sm:text-[2.25rem]">
              ¿Tenés un departamento en Córdoba?
            </h2>
            <p className="mt-2 font-apart-serif text-xl italic text-forest-600 sm:text-2xl">Nosotros lo cuidamos.</p>
            <p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-ink-700 max-sm:text-[0.9375rem]">
              Lo publicamos, atendemos a cada huésped y te rendimos cuentas todos los meses, con el detalle de
              cada reserva.
            </p>
          </div>
          <ApartButton asChild variant="primary" size="lg" className="self-start lg:self-auto">
            <Link href="/propietarios">
              Conocé cómo trabajamos
              <ArrowRight aria-hidden />
            </Link>
          </ApartButton>
        </div>
      </Reveal>
    </section>
  );
}
