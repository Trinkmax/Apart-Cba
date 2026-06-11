import Image from "next/image";
import { MapPin } from "lucide-react";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
// sage-500 (#7d8e74) — mismo color que tenía el marker del mapa interactivo.
const PIN_COLOR = "7d8e74";

// Mapa decorativo (un solo pin, sin zoom): usamos la Static Images API de Mapbox
// en vez de montar mapbox-gl (~1,7 MB de parse + WebGL). Server component, 0 KB
// de JS en el cliente.
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

  // 800x450@2x = 16:9, igual que el aspect ratio del contenedor. logo/attribution
  // off para mantener el look del mapa anterior (attributionControl={false}).
  const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+${PIN_COLOR}(${longitude},${latitude})/${longitude},${latitude},14/800x450@2x?access_token=${TOKEN}&logo=false&attribution=false`;

  return (
    <div className="relative aspect-[16/9] rounded-2xl overflow-hidden border border-neutral-200 bg-neutral-100">
      <Image
        src={staticMapUrl}
        alt={`Mapa de la ubicación${neighborhood ? ` en ${neighborhood}` : ""}`}
        fill
        className="object-cover"
        sizes="(min-width: 1400px) 888px, (min-width: 1024px) calc(100vw - 512px), calc(100vw - 32px)"
      />
    </div>
  );
}
