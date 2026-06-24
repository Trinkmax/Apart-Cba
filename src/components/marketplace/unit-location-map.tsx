"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
// sage-500 (#7d8e74) — mismo color que el marker del mapa interactivo.
const PIN_COLOR = "7d8e74";

// mapbox-gl pesa ~470 KB gz (~1,7 MB de parse) + WebGL: lo cargamos on-demand,
// sólo cuando el usuario llega a esta sección (IntersectionObserver más abajo).
const UnitLocationMapInteractive = dynamic(
  () => import("./unit-location-map-interactive"),
  { ssr: false },
);

type Props = {
  latitude: number;
  longitude: number;
  neighborhood?: string | null;
};

export function UnitLocationMap({ latitude, longitude, neighborhood }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Montamos el mapa interactivo recién cuando el contenedor entra al viewport.
  const [mounted, setMounted] = useState(false);
  // Cuando el mapa terminó de cargar desvanecemos la imagen estática de fondo.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!TOKEN || mounted) return;
    const el = containerRef.current;
    if (!el) return;

    // Sin IntersectionObserver (entornos muy viejos): montamos directo en el
    // próximo tick para no sincronizar setState dentro del cuerpo del effect.
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(id);
    }

    // Pre-montamos un poco antes de que sea visible (rootMargin) para que el
    // mapa esté listo cuando el usuario llega a la sección.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  // Sin token: fallback neutral (caja con pin + barrio), igual que antes.
  if (!TOKEN) {
    return (
      <div className="aspect-[16/9] bg-neutral-100 rounded-2xl grid place-items-center text-sm text-neutral-500">
        <div className="flex items-center gap-2">
          <MapPin size={16} />
          <span>{neighborhood ?? "Ubicación"}</span>
        </div>
      </div>
    );
  }

  // 800x450@2x = 16:9, igual que el aspect ratio del contenedor. logo/attribution
  // off para mantener el look del mapa anterior (attributionControl={false}).
  const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+${PIN_COLOR}(${longitude},${latitude})/${longitude},${latitude},14/800x450@2x?access_token=${TOKEN}&logo=false&attribution=false`;

  return (
    <div
      ref={containerRef}
      className="relative aspect-[16/9] rounded-2xl overflow-hidden border border-neutral-200 bg-neutral-100"
    >
      {/* Imagen estática: primer paint y placeholder hasta que el mapa cargue.
          Queda detrás del mapa y se desvanece cuando éste está listo. */}
      <Image
        src={staticMapUrl}
        alt={`Mapa de la ubicación${neighborhood ? ` en ${neighborhood}` : ""}`}
        fill
        className={`object-cover transition-opacity duration-300 ${
          mapReady ? "opacity-0" : "opacity-100"
        }`}
        sizes="(min-width: 1400px) 888px, (min-width: 1024px) calc(100vw - 512px), calc(100vw - 32px)"
      />

      {mounted ? (
        <div className="absolute inset-0">
          <UnitLocationMapInteractive
            latitude={latitude}
            longitude={longitude}
            onReady={() => setMapReady(true)}
          />
        </div>
      ) : null}
    </div>
  );
}
