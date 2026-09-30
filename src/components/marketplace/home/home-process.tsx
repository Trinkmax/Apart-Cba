import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArcBand, SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { ProcessSteps } from "@/components/marketplace/brand/process-steps";
import { Reveal } from "@/components/marketplace/reveal";
import { BrandPhoto } from "./brand-photo";

/**
 * "Así de simple": el proceso real (pedido sin pago → confirmación → seña
 * por transferencia → resto al llegar) con la política de la organización.
 */
export function HomeProcess({ responseHours, senaLabel }: { responseHours: number; senaLabel: string | null }) {
  return (
    <section className="px-2 sm:px-4 lg:px-6">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] bg-cream-200 px-4 py-14 sm:rounded-[2.5rem] sm:px-8 sm:py-20 lg:px-12 lg:py-24">
        <ArcBand
          thickness={10}
          className="absolute -left-10 -top-6 w-44 rotate-180 text-leaf-300/60 sm:w-56 lg:-left-14 lg:w-72"
        />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:gap-16">
          <div>
            <Reveal>
              <SectionHeading
                eyebrow="Cómo se reserva"
                title="Reservar con nosotros es así de simple"
                accent="Primero te confirmamos. Después pagás."
              />
            </Reveal>
            <Reveal delay={120} y={16}>
              <ProcessSteps
                responseHours={responseHours}
                senaLabel={senaLabel}
                className="mt-10 gap-x-8 gap-y-9 sm:mt-12 lg:grid-cols-2"
              />
            </Reveal>
            <Reveal delay={200} y={10}>
              <Link
                href="/como-reservar"
                className="group mt-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-paper px-5 text-[0.9375rem] font-bold text-forest-700 shadow-apart-sm ring-1 ring-cream-300 transition-colors hover:bg-white"
              >
                Cómo reservar, paso a paso
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </Reveal>
          </div>

          <Reveal y={24} className="relative mx-auto w-full max-w-[26rem] lg:max-w-none">
            <div className="aspect-[4/5] overflow-hidden rounded-t-full rounded-b-3xl bg-cream-300 shadow-apart-md">
              <BrandPhoto
                name="llaves"
                alt="Llaveros de apart en forma de arco, con las llaves de un departamento"
                sizes="(min-width: 1024px) 34vw, (min-width: 640px) 26rem, 92vw"
                className="object-[46%_50%]"
              />
            </div>
            <span
              aria-hidden
              className="absolute -right-2 top-[18%] size-10 rounded-full bg-coral-500 shadow-apart-sm sm:-right-4 sm:size-12"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
