"use client";

import Map, { Marker } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin } from "lucide-react";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export function UnitLocationMap({
  latitude,
  longitude,
  neighborhood,
}: {
  latitude: number;
  longitude: number;
  neighborhood?: string | null;
}) {
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
  return (
    <div className="aspect-[16/9] rounded-2xl overflow-hidden border border-neutral-200">
      <Map
        mapboxAccessToken={TOKEN}
        initialViewState={{ latitude, longitude, zoom: 14 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        scrollZoom={false}
      >
        <Marker latitude={latitude} longitude={longitude} anchor="center">
          <div className="h-12 w-12 rounded-full bg-rose-500/30 grid place-items-center">
            <div className="h-5 w-5 rounded-full bg-rose-500 border-2 border-white shadow-md" />
          </div>
        </Marker>
      </Map>
    </div>
  );
}
