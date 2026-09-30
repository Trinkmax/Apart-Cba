import { BookHeart, CalendarRange, HeartHandshake, MapPin } from "lucide-react";
import { Reveal } from "@/components/marketplace/reveal";

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
      <ul className="mx-auto grid max-w-[1320px] grid-cols-2 gap-x-4 gap-y-8 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-4 lg:gap-x-8 lg:px-8 lg:py-14">
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
