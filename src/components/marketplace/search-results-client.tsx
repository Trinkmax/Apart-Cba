"use client";

import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Map as MapIcon, List } from "lucide-react";
import { ListingCard } from "./listing-card";
import { cn } from "@/lib/utils";
import type { MarketplaceListingSummary } from "@/lib/types/database";

const DESKTOP_MQ = "(min-width: 768px)";

// Suscripción a matchMedia vía la API canónica de React (sin setState-en-effect
// ni hydration mismatch): el snapshot del server es false → el HTML inicial
// renderiza el placeholder; tras la hidratación el cliente re-lee el snapshot
// real y, si es desktop, monta el mapa.
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP_MQ);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => false,
  );
}

// mapbox-gl pesa ~470 KB gz (~1,7 MB de parse) + WebGL: lo cargamos on-demand
// en vez de incluirlo en el bundle inicial de /buscar.
const ListingsMap = dynamic(
  () => import("./listings-map").then((m) => m.ListingsMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-muted" />,
  }
);

type Props = {
  listings: MarketplaceListingSummary[];
  favoritedIds: string[];
};

export function SearchResultsClient({ listings, favoritedIds }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  // En mobile el mapa NO se monta hasta que el usuario toca "Ver mapa" (antes
  // quedaba montado en un div display:none → descarga + WebGL al pedo). En
  // desktop se monta solo (el mapa es parte del layout). `userOpenedMap` es el
  // latch del toggle mobile.
  const isDesktop = useIsDesktop();
  const [userOpenedMap, setUserOpenedMap] = useState(false);
  const mapMounted = isDesktop || userOpenedMap;
  const favSet = new Set(favoritedIds);

  if (listings.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-16 text-center">
        <div className="text-5xl mb-4">🏝️</div>
        <h2 className="text-2xl font-semibold text-neutral-900">No encontramos lugares con esos filtros</h2>
        <p className="mt-3 text-neutral-600 max-w-md mx-auto">
          Probá ampliar las fechas, sumar más huéspedes, o quitar algunos filtros para ver más opciones.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:grid md:grid-cols-[1fr_minmax(0,500px)] xl:grid-cols-[1fr_minmax(0,560px)]">
      {/* Listings */}
      <div className={cn("relative", mobileView === "map" && "hidden md:block")}>
        <div className="max-w-[900px] px-4 md:px-8 py-6 md:py-8 ml-auto md:ml-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 md:gap-8">
            {listings.map((listing, i) => (
              <div
                key={listing.id}
                onMouseEnter={() => setHovered(listing.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <ListingCard
                  listing={listing}
                  isFavorited={favSet.has(listing.id)}
                  priority={i < 4}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Map */}
      <div
        className={cn(
          "md:sticky md:top-[140px] h-[calc(100vh-140px)] md:h-[calc(100vh-140px)]",
          mobileView === "list" && "hidden md:block"
        )}
      >
        {mapMounted ? (
          <ListingsMap
            listings={listings}
            hoveredId={hovered}
            onMarkerHover={setHovered}
          />
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
      </div>

      {/* Mobile floating toggle */}
      <button
        onClick={() => {
          const next = mobileView === "list" ? "map" : "list";
          if (next === "map") setUserOpenedMap(true);
          setMobileView(next);
        }}
        className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-5 py-2.5 shadow-2xl text-sm font-medium"
      >
        {mobileView === "list" ? (
          <>
            <MapIcon size={16} />
            Ver mapa
          </>
        ) : (
          <>
            <List size={16} />
            Ver lista
          </>
        )}
      </button>
    </div>
  );
}
