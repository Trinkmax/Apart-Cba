import { ArcBand, SectionHeading } from "@/components/marketplace/brand/brand-shapes";
import { Reveal } from "@/components/marketplace/reveal";
import { hoursLabel } from "@/lib/marketplace/web-settings";
import { cn } from "@/lib/utils";

/** "Cómo empezamos": el camino real de un propietario nuevo, en tres pasos. */
export function OwnersSteps({
  responseHours,
  hasWhatsapp = false,
}: {
  responseHours: number;
  /** Sólo se nombra WhatsApp si la organización cargó un número. */
  hasWhatsapp?: boolean;
}) {
  const steps = [
    {
      title: "Nos contactás",
      body: `Dejás tus datos en el formulario${hasWhatsapp ? " o nos escribís por WhatsApp" : ""}. Te respondemos en menos de ${hoursLabel(responseHours)}.`,
    },
    {
      title: "Visitamos el departamento",
      body: "Lo conocemos en persona, te contamos cómo trabajamos y vemos juntos qué necesita para recibir huéspedes.",
    },
    {
      title: "Lo publicamos",
      body: "Armamos la publicación, conectamos el calendario de todos los canales y queda listo para recibir reservas.",
    },
  ];

  return (
    <section aria-labelledby="owners-steps-title" className="px-2 sm:px-4 lg:px-6">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] bg-cream-200 px-4 py-14 max-sm:py-10 sm:rounded-[2.5rem] sm:px-8 sm:py-20 sm:max-lg:py-14 lg:px-12">
        <ArcBand
          thickness={10}
          className="absolute -bottom-3 -left-10 w-44 text-leaf-300/70 sm:w-60 lg:-left-12 lg:w-72"
        />
        <div className="relative mx-auto max-w-[1240px]">
          <Reveal>
            <SectionHeading
              eyebrow="Cómo empezamos"
              title={<span id="owners-steps-title">Empezar es simple</span>}
              accent="Tres pasos, y del resto nos ocupamos nosotros."
            />
          </Reveal>
          {/* Celular (< md): línea de tiempo compacta (arco numerado + texto, unidos por
              un hilo). Desde md, las tres tarjetas de siempre. */}
          <ol className="mt-10 grid gap-4 max-md:gap-7 max-sm:mt-8 sm:mt-12 md:grid-cols-3 md:gap-5">
            {steps.map((s, i) => (
              <Reveal
                as="li"
                key={s.title}
                delay={i * 110}
                y={16}
                className={cn(
                  "relative rounded-3xl bg-paper p-6 shadow-apart-sm ring-1 ring-cream-300 sm:p-7",
                  "max-md:grid max-md:grid-cols-[3rem_minmax(0,1fr)] max-md:gap-x-4 max-md:rounded-none max-md:bg-transparent max-md:p-0 max-md:shadow-none max-md:ring-0 sm:max-md:p-0",
                  i < steps.length - 1 &&
                    "max-md:after:absolute max-md:after:-bottom-4 max-md:after:left-6 max-md:after:top-[4.25rem] max-md:after:w-px max-md:after:bg-forest-700/25",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-14 w-12 items-end justify-center rounded-t-full rounded-b-lg bg-forest-700 pb-2 font-apart-serif text-2xl italic leading-none text-cream max-md:row-span-2"
                >
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-extrabold leading-snug tracking-[-0.01em] text-forest-700 max-md:col-start-2 max-md:mt-1">
                  <span className="sr-only">Paso {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-700 max-md:col-start-2">{s.body}</p>
                {i < steps.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute -right-[0.8rem] top-[3.25rem] hidden h-px w-[0.95rem] bg-forest-700/25 md:block"
                  />
                ) : null}
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
