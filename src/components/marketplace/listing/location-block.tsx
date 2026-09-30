import { MapPin } from "lucide-react";
import { UnitLocationMap } from "@/components/marketplace/unit-location-map";

/**
 * Ubicación: mapa lazy con el pin de apart, barrio y ciudad. No promete
 * esconder la dirección (casi todas las descripciones la incluyen y el pin es
 * exacto): lo que se coordina al confirmar es cómo llegar y las llaves.
 */
export function LocationBlock({
  latitude,
  longitude,
  hood,
  city,
}: {
  latitude: number | null;
  longitude: number | null;
  hood: string | null;
  city: string | null;
}) {
  const place = [hood, city ?? "Córdoba"].filter(Boolean).join(", ");
  const hasPin = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);
  return (
    <div className="space-y-4">
      {hasPin ? <UnitLocationMap latitude={latitude} longitude={longitude} label={place} /> : null}
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-coral-100 text-coral-800">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-forest-700">{place}</p>
          <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-500">
            Te pasamos cómo llegar y coordinamos la entrega de llaves cuando confirmamos tu reserva.
          </p>
        </div>
      </div>
    </div>
  );
}
