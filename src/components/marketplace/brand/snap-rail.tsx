"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { MOBILE_RAIL } from "./snap-rail-classes";

// Las clases viven en snap-rail-classes.ts (sin "use client"): los server
// components tienen que importarlas desde ahí, no desde este módulo cliente.
// Se reexportan para los componentes cliente que ya las toman de acá.
export { MOBILE_RAIL, MOBILE_RAIL_ITEM } from "./snap-rail-classes";

/**
 * Riel horizontal para celular y tablet (por debajo de `lg`): scroll con snap,
 * la tarjeta siguiente asomada ("peek") y una barra de progreso que acompaña el
 * scroll. En escritorio NO toca nada: todas sus clases propias son `max-lg:`,
 * así que el layout de `lg` en adelante lo ponen las clases que le pasa quien
 * lo usa (p. ej. `lg:grid lg:grid-cols-4 lg:gap-6`), idénticas a las de antes.
 *
 * Los hijos se dibujan tal cual (sin envolverlos): para el ancho de cada
 * tarjeta en el riel usá `MOBILE_RAIL_ITEM` en el propio hijo.
 */

type RailTag = "div" | "ul" | "ol";

export function SnapRail({
  as = "div",
  label,
  className,
  progressClassName,
  progress = true,
  children,
}: {
  as?: RailTag;
  /** Nombre accesible del riel ("Lugares para quedarte"). */
  label?: string;
  /** Clases del contenedor: van DESPUÉS de las del riel (acá va el layout de lg). */
  className?: string;
  progressClassName?: string;
  /** Barra de progreso debajo del riel (sólo en celular). */
  progress?: boolean;
  children: React.ReactNode;
}) {
  const railRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // La barra se mueve tocando el DOM directo (sin estado de React): el scroll
  // no re-renderiza nada. Mide al montar (ResizeObserver dispara al observar),
  // en cada scroll (un frame por vez) y cuando cambia el tamaño.
  useEffect(() => {
    const rail = railRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!rail || !track || !thumb) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 1) {
        track.style.visibility = "hidden";
        return;
      }
      track.style.visibility = "visible";
      const size = Math.max(0.12, Math.min(1, rail.clientWidth / rail.scrollWidth));
      const ratio = Math.min(1, Math.max(0, rail.scrollLeft / max));
      thumb.style.width = `${size * 100}%`;
      thumb.style.transform = `translate3d(${(ratio * (1 - size) * 100) / size}%, 0, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(rail);
    return () => {
      rail.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const Tag = as;
  return (
    <>
      <Tag
        ref={railRef as never}
        aria-label={label}
        role={as === "div" ? (label ? "group" : undefined) : undefined}
        className={cn(MOBILE_RAIL, className)}
      >
        {children}
      </Tag>
      {progress ? (
        <div
          ref={trackRef}
          aria-hidden
          className={cn(
            "mx-auto mt-4 h-1 w-20 overflow-hidden rounded-full bg-forest-700/10 lg:hidden",
            progressClassName,
          )}
        >
          <div
            ref={thumbRef}
            className="h-full w-1/3 rounded-full bg-forest-700/55 transition-transform duration-150 ease-out motion-reduce:transition-none"
          />
        </div>
      ) : null}
    </>
  );
}
