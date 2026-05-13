"use client";

import { useCallback, useMemo, useState } from "react";
import Map, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { formatInCurrency } from "@/lib/marketplace/currency-config";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import type { MarketplaceListingSummary } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Props = {
  listings: MarketplaceListingSummary[];
  hoveredId?: string | null;
  onMarkerHover?: (id: string | null) => void;
};

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export function ListingsMap({ listings, hoveredId, onMarkerHover }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const { currency: targetCurrency, locale } = useMarketplacePrefs();

  const withCoords = useMemo(
    () =>
      listings.filter(
        (l) => l.latitude !== null && l.longitude !== null
      ),
    [listings]
  );

  const center = useMemo(() => {
    if (withCoords.length === 0) {
      return { latitude: -31.42, longitude: -64.19 }; // Córdoba default
    }
    const avgLat =
      withCoords.reduce((acc, l) => acc + (l.latitude as number), 0) /
      withCoords.length;
    const avgLng =
      withCoords.reduce((acc, l) => acc + (l.longitude as number), 0) /
      withCoords.length;
    return { latitude: avgLat, longitude: avgLng };
  }, [withCoords]);

  const selectedListing = useMemo(
    () => listings.find((l) => l.id === selected) ?? null,
    [selected, listings]
  );

  const handleMarkerClick = useCallback((id: string) => {
    setSelected((prev) => (prev === id ? null : id));
  }, []);

  if (!TOKEN) {
    return (
      <div className="h-full w-full bg-neutral-100 rounded-2xl grid place-items-center text-center p-6 text-sm text-neutral-500">
        <div>
          <div className="font-medium text-neutral-700 mb-1">Mapa no disponible</div>
          <div>Falta NEXT_PUBLIC_MAPBOX_TOKEN para mostrar el mapa.</div>
        </div>
      </div>
    );
  }

  return (
    <Map
      mapboxAccessToken={TOKEN}
      initialViewState={{
        latitude: center.latitude,
        longitude: center.longitude,
        zoom: 11,
      }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      <NavigationControl position="top-right" showCompass={false} />
      {withCoords.map((l) => {
        const isActive = hoveredId === l.id || selected === l.id;
        return (
          <Marker
            key={l.id}
            latitude={l.latitude as number}
            longitude={l.longitude as number}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              handleMarkerClick(l.id);
            }}
          >
            <button
              type="button"
              onMouseEnter={() => onMarkerHover?.(l.id)}
              onMouseLeave={() => onMarkerHover?.(null)}
              className={cn(
                "rounded-full font-semibold text-xs shadow-lg transition-all px-3 py-1.5 whitespace-nowrap",
                isActive
                  ? "bg-neutral-900 text-white scale-110 z-10"
                  : "bg-white text-neutral-900 hover:scale-105"
              )}
            >
              {formatInCurrency(l.base_price, l.marketplace_currency, targetCurrency, locale)}
            </button>
          </Marker>
        );
      })}

      {selectedListing && selectedListing.latitude !== null && selectedListing.longitude !== null ? (
        <Popup
          latitude={selectedListing.latitude}
          longitude={selectedListing.longitude}
          anchor="bottom"
          onClose={() => setSelected(null)}
          closeButton={false}
          offset={20}
          maxWidth="240px"
        >
          <a
            href={`/u/${selectedListing.slug}`}
            className="block w-56 -m-2 rounded-xl overflow-hidden bg-white"
          >
            <div className="aspect-[4/3] bg-neutral-100 overflow-hidden">
              {selectedListing.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedListing.cover_url}
                  alt={selectedListing.marketplace_title}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
            <div className="p-3 space-y-1">
              <div className="text-xs text-neutral-500 truncate">
                {selectedListing.neighborhood ?? selectedListing.address ?? ""}
              </div>
              <div className="text-sm font-medium text-neutral-900 line-clamp-1">
                {selectedListing.marketplace_title}
              </div>
              <div className="text-sm">
                <span className="font-semibold">
                  {formatInCurrency(
                    selectedListing.base_price,
                    selectedListing.marketplace_currency,
                    targetCurrency,
                    locale,
                  )}
                </span>
                <span className="text-neutral-500"> /noche</span>
              </div>
            </div>
          </a>
        </Popup>
      ) : null}
    </Map>
  );
}
