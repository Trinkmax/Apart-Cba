"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
/** coral-500 de la marca (#ED7059), para el pin de la imagen estática. */
const PIN_COLOR = "ed7059";

// mapbox-gl pesa ~470 KB gz + WebGL: se carga recién cuando la sección está
// por entrar en pantalla (IntersectionObserver) y nunca en el server.
const UnitLocationMapInteractive = dynamic(() => import("./unit-location-map-interactive"), { ssr: false });

/**
 * Mapa de la ficha. Primero una imagen estática (liviana, sirve de
 * placeholder); cerca del viewport se monta el mapa interactivo encima y la
 * imagen se desvanece cuando éste terminó de cargar.
 */
export function UnitLocationMap({
  latitude,
  longitude,
  label,
  className,
}: {
  latitude: number;
  longitude: number;
  /** "Nueva Córdoba, Córdoba" (texto alternativo y fallback sin token). */
  label: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!TOKEN || mounted) return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  const frame = cn("relative aspect-[4/3] overflow-hidden rounded-3xl bg-leaf-100 ring-1 ring-cream-300 sm:aspect-[16/9]", className);

  if (!TOKEN) {
    return (
      <div className={cn(frame, "grid place-items-center")}>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-forest-700">
          <MapPin className="size-4 text-coral-500" aria-hidden />
          {label}
        </span>
      </div>
    );
  }

  // 800×600@2x (4:3) cubre también el 16:9 recortado con object-cover.
  const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+${PIN_COLOR}(${longitude},${latitude})/${longitude},${latitude},14.5/800x600@2x?access_token=${TOKEN}&logo=false&attribution=false`;

  return (
    <div ref={containerRef} className={frame}>
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Mapbox sin optimizar (placeholder) */}
      <img
        src={staticMapUrl}
        alt={`Mapa de la zona: ${label}`}
        loading="lazy"
        decoding="async"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
          mapReady ? "opacity-0" : "opacity-100",
        )}
      />
      {mounted ? (
        <div className="absolute inset-0">
          <UnitLocationMapInteractive latitude={latitude} longitude={longitude} onReady={() => setMapReady(true)} />
        </div>
      ) : null}
    </div>
  );
}
