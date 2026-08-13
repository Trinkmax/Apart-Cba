"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Los módulos del panel, en carrusel.
 *
 * Antes era una grilla de seis tarjetas: en desktop entraba bien, pero en mobile
 * eran seis bloques apilados y la página se hacía interminable justo antes del
 * CTA. Acá ocupan una sola pantalla y se recorren con el dedo.
 *
 * Sin librería de carrusel: es scroll nativo con `scroll-snap`, que en mobile ya
 * trae la inercia y el gesto del sistema operativo. El indicador activo sale de
 * un IntersectionObserver sobre el propio track, no de un listener de scroll.
 */

export type ModuleSlide = {
  key: string;
  title: string;
  body: string;
  /** Escena que representa al módulo (ver `lib/marketing/module-photos.ts`). */
  image: { url: string; alt: string };
  sample: React.ReactNode;
};

export function ModulesCarousel({ slides }: { slides: ModuleSlide[] }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const items = Array.from(track.querySelectorAll<HTMLElement>("[data-slide]"));
    const io = new IntersectionObserver(
      (entries) => {
        // El slide activo es el primero que se ve entero; con varios visibles,
        // el de más a la izquierda manda (es el que "encabeza" la página).
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.slide));
        if (visible.length) setActive(Math.min(...visible));

        setEdges({
          start: track.scrollLeft <= 4,
          end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4,
        });
      },
      { root: track, threshold: 0.75 }
    );

    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [slides.length]);

  /**
   * Navegar por índice y no con `scrollBy`: con `scroll-snap-type: x mandatory`
   * el navegador vuelve a enganchar al punto de snap más cercano apenas arranca
   * la animación, así que un scrollBy de un ancho de tarjeta terminaba moviendo
   * unos pocos píxeles. `scrollIntoView` sí respeta el snap.
   */
  const goTo = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = track.querySelector<HTMLElement>(`[data-slide="${index}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const next = Math.min(Math.max(active + dir, 0), slides.length - 1);
      goTo(next);
    },
    [active, goTo, slides.length]
  );

  return (
    <div>
      <ul
        ref={trackRef}
        className="scroll-snap-x no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0"
      >
        {slides.map((slide, i) => (
          <li
            key={slide.key}
            data-slide={i}
            className="w-[84vw] shrink-0 snap-start sm:w-[62vw] md:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)]"
          >
            <Card className="h-full gap-0 overflow-hidden p-0">
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-secondary">
                <Image
                  src={slide.image.url}
                  alt={slide.image.alt}
                  fill
                  sizes="(max-width: 768px) 84vw, (max-width: 1024px) 50vw, 33vw"
                  loading={i === 0 ? "eager" : "lazy"}
                  className="object-cover"
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/5"
                />
                <h3 className="absolute bottom-3 left-4 right-4 text-[17px] font-semibold text-white drop-shadow-sm">
                  {slide.title}
                </h3>
              </div>

              <div className="flex flex-1 flex-col p-5">
                <p className="text-sm leading-relaxed text-muted-foreground">{slide.body}</p>
                <div className="mt-auto pt-5">{slide.sample}</div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Módulos">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={slide.title}
              onClick={() => goTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === active ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40"
              )}
            />
          ))}
        </div>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            aria-label="Anterior"
            disabled={edges.start}
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            aria-label="Siguiente"
            disabled={edges.end}
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
