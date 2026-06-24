"use client";

import Map, { Marker, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin } from "lucide-react";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// sage-500 del proyecto (#7d8e74).
const SAGE_500 = "#7d8e74";

type Props = {
  latitude: number;
  longitude: number;
  // Se dispara cuando el canvas del mapa terminó de cargar; el wrapper lo usa
  // para desvanecer la imagen estática que sirve de placeholder.
  onReady?: () => void;
};

// Mapa interactivo (drag-pan con un dedo, pinch-zoom con dos, botones de zoom).
// Se monta lazy desde el wrapper para no incluir mapbox-gl (~1,7 MB) en el
// bundle inicial de la página. Sin SSR (ssr:false en el next/dynamic del wrapper).
export default function UnitLocationMapInteractive({
  latitude,
  longitude,
  onReady,
}: Props) {
  return (
    <Map
      mapboxAccessToken={TOKEN}
      initialViewState={{ latitude, longitude, zoom: 15 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onLoad={() => onReady?.()}
      // Mantener el gesto de un dedo = panear (drag-pan nativo). NO usar
      // cooperativeGestures: rompería el pan con un dedo en mobile.
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
    >
      {/* Botones de zoom; sin brújula porque no permitimos rotar. */}
      <NavigationControl position="top-right" showCompass={false} />

      <Marker latitude={latitude} longitude={longitude} anchor="bottom">
        {/* Pin estilo sage premium: ícono relleno con stroke blanco + sombra. */}
        <MapPin
          size={36}
          fill={SAGE_500}
          stroke="#ffffff"
          strokeWidth={1.75}
          className="drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)]"
          aria-hidden="true"
        />
      </Marker>
    </Map>
  );
}
