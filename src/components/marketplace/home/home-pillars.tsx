import { BookHeart, CalendarRange, HeartHandshake, MapPin } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";
import { cn } from "@/lib/utils";

/** Los cuatro pilares del manual de marca, tal cual los escribió la agencia. */
const PILLARS = [
  { icon: CalendarRange, title: "Estadías flexibles", body: "Desde una noche hasta varios meses." },
  { icon: MapPin, title: "Ubicación óptima", body: "Para descubrir mejor la ciudad." },
  { icon: HeartHandshake, title: "Calidez humana", body: "De persona a persona." },
  { icon: BookHeart, title: "Experiencias que quedan", body: "Más que una estadía, una buena historia." },
];

export function HomePillars() {
  return (
    <section aria-label="Por qué apart" className="border-y border-cream-300/80 bg-cream-50">
      <PillarsStrip />
      {/* Escritorio: la grilla de siempre (en celular y tablet va la franja). */}
      <ul className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-4 gap-y-8 px-4 py-10 sm:px-6 sm:py-12 max-lg:hidden lg:grid-cols-4 lg:gap-x-8 lg:px-8 lg:py-14">
        {PILLARS.map((p, i) => (
          <Reveal as="li" key={p.title} delay={i * 90} y={14} className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-leaf-300/70 text-forest-700 ring-4 ring-leaf-100 sm:size-14">
              <p.icon className="size-5 sm:size-6" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-extrabold leading-tight tracking-[-0.01em] text-forest-700 sm:text-base">
                {p.title}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-500">{p.body}</span>
            </span>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

/**
 * Celular y tablet: una franja de pastillas (ícono + título, sin la bajada) que
 * corre sola y despacio. La cinta tiene dos copias iguales y se corre la mitad
 * de su ancho (keyframes `marquee`), así el giro no se nota; la segunda copia es
 * `aria-hidden`. Se frena mientras se toca; con "reducir movimiento" queda
 * quieta y se puede deslizar a mano.
 */
function PillarsStrip() {
  return (
    <div
      className={cn(
        "group overflow-hidden py-3.5 pl-4 sm:pl-6 lg:hidden",
        "[mask-image:linear-gradient(to_right,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)]",
        "motion-reduce:overflow-x-auto motion-reduce:[scrollbar-width:none] motion-reduce:[&::-webkit-scrollbar]:hidden",
      )}
    >
      <div className="flex w-max motion-safe:animate-[marquee_34s_linear_infinite] group-hover:[animation-play-state:paused] group-active:[animation-play-state:paused]">
        <PillarChips />
        <PillarChips duplicate />
      </div>
    </div>
  );
}

function PillarChips({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      aria-hidden={duplicate || undefined}
      // pr = gap: entre la última pastilla de una copia y la primera de la otra hay el mismo aire.
      className={cn("flex shrink-0 gap-2.5 pr-2.5", duplicate && "motion-reduce:hidden")}
    >
      {PILLARS.map((p) => (
        <li
          key={p.title}
          className="flex shrink-0 items-center gap-2.5 rounded-full bg-paper py-1.5 pl-1.5 pr-4 shadow-apart-sm ring-1 ring-cream-300"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-leaf-300/70 text-forest-700">
            <p.icon className="size-4" strokeWidth={1.9} aria-hidden />
          </span>
          <span className="whitespace-nowrap text-sm font-extrabold tracking-[-0.01em] text-forest-700">{p.title}</span>
        </li>
      ))}
    </ul>
  );
}
