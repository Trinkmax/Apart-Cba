import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
import { ArcBand, BrandDot, Eyebrow } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";
import { BrandPhoto } from "./brand-photo";

/**
 * "Hacemos lugar.": el concepto de la marca ("De ubicación a lugar") con la
 * foto del cuidado de la cama en arco y la tarjeta de bienvenida.
 */
export function HomeStory() {
  return (
    <section className="overflow-hidden py-16 sm:py-24 lg:py-28">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20 lg:px-8">
        <Reveal y={24} className="relative mx-auto w-full max-w-[28rem] lg:max-w-none">
          <ArcBand thickness={14} className="absolute -left-8 -top-6 w-40 text-leaf-300 sm:-left-10 sm:w-52" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-t-full rounded-b-3xl bg-cream-300 shadow-apart-lg">
            <BrandPhoto
              name="cuidado-cama"
              alt="Manos acomodando un almohadón sobre una cama recién tendida"
              sizes="(min-width: 1024px) 34vw, (min-width: 640px) 28rem, 92vw"
              className="object-[60%_50%]"
            />
          </div>
          <div className="absolute -bottom-8 -right-2 w-[46%] rotate-[4deg] overflow-hidden rounded-2xl bg-paper p-1.5 shadow-apart-lg ring-1 ring-cream-300 sm:-right-8 sm:w-[42%]">
            <div className="aspect-[6/5] overflow-hidden rounded-xl">
              <BrandPhoto
                name="bienvenida"
                alt="Tarjetas de bienvenida de apart: «Qué lindo tenerte por Córdoba» y «Cuidemos el lugar»"
                sizes="(min-width: 1024px) 16vw, 42vw"
              />
            </div>
          </div>
        </Reveal>

        <Reveal delay={120} y={18} className="lg:pl-4">
          <Eyebrow>De ubicación a lugar</Eyebrow>
          <h2 className="mt-3 font-apart text-[2.25rem] font-extrabold leading-[1.02] tracking-[-0.03em] text-forest-700 sm:text-5xl lg:text-[3.5rem]">
            Hacemos lugar
            <BrandDot />
          </h2>
          <p className="mt-2 font-apart-serif text-xl italic text-forest-600 sm:text-2xl">
            Para personas, ideas y llegadas.
          </p>
          <div className="mt-7 max-w-xl space-y-4 text-[1.0625rem] leading-relaxed text-ink-700">
            <p>
              apart entiende el alojamiento desde un lugar más cercano: no alcanza con tener dónde quedarse,
              también importa cómo te reciben, cómo se cuida el espacio y quién está del otro lado.
            </p>
            <p>Una forma simple y humana de acompañar a quienes llegan y a quienes confían su propiedad.</p>
          </div>
          <div className="mt-9 flex items-center gap-4 border-t border-cream-300 pt-7">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-coral-500">
              <ApartLogo variant="symbol" title={null} className="h-5" />
            </span>
            <p className="font-apart-serif text-xl italic leading-snug text-forest-700 sm:text-[1.375rem]">
              Buenas estancias, mejores historias.
              <span className="mt-0.5 block font-apart text-xs font-bold not-italic uppercase tracking-[0.2em] text-ink-500">
                El equipo de apart
              </span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
