"use client";

import Map, { Marker, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/**
 * Mapa interactivo de la ficha (drag con un dedo, pinch-zoom, botones de
 * zoom). Se monta lazy desde unit-location-map (ssr: false). El pin es el
 * símbolo de apart sobre una gota coral.
 */
export default function UnitLocationMapInteractive({
  latitude,
  longitude,
  onReady,
}: {
  latitude: number;
  longitude: number;
  /** Se llama cuando el canvas cargó (el wrapper desvanece la imagen estática). */
  onReady?: () => void;
}) {
  return (
    <Map
      mapboxAccessToken={TOKEN}
      initialViewState={{ latitude, longitude, zoom: 15 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      onLoad={() => onReady?.()}
      // Un dedo = panear. NO cooperativeGestures: rompe el pan en mobile.
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      scrollZoom={false}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <Marker latitude={latitude} longitude={longitude} anchor="bottom">
        <div className="pb-2.5 drop-shadow-[0_8px_12px_rgb(20_84_71/0.35)]" aria-hidden>
          <div className="grid size-12 rotate-45 place-items-center rounded-full rounded-br-none bg-coral-500 ring-[3px] ring-paper">
            <ApartLogo variant="symbol" title={null} className="h-5 -rotate-45 text-paper" />
          </div>
        </div>
      </Marker>
    </Map>
  );
}
