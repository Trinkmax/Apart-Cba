"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Map, { Marker, NavigationControl, Popup, type MapRef } from "react-map-gl/mapbox";
import type { LngLatBounds } from "mapbox-gl";
import type { CatalogListing } from "@/lib/marketplace/contracts";
import {
  cardPrice,
  listingHref,
  nightsLabel,
  type SearchMode,
  type StayInput,
} from "@/lib/marketplace/catalog-filter";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { bedroomsLabel, guestsLabel } from "@/lib/marketplace/display";
import { cn } from "@/lib/utils";
import { useHoveredId, type HoverStore } from "@/components/marketplace/search/hover-store";
import {
  CORDOBA_CENTER,
  MAPBOX_TOKEN,
  MAP_COLORS,
} from "@/components/marketplace/search/map-config";

export type ListingsMapProps = {
  listings: CatalogListing[];
  view: SearchMode;
  stay?: StayInput;
  /** Tarjeta activa compartida con la grilla (hover/foco). */
  hoverStore: HoverStore;
  /** Desktop: popup con tarjeta mini. Mobile: sin popup (hay carrusel abajo). */
  popups?: boolean;
  /** Al tocar una píldora (mobile: el carrusel se mueve a esa tarjeta). */
  onSelect?: (id: string) => void;
  className?: string;
};

type Located = CatalogListing & { latitude: number; longitude: number };

/**
 * Separación del globo según de qué lado del precio lo ubique Mapbox (el
 * ancla se elige sola para que entre en el mapa). La píldora está ARRIBA del
 * punto (anchor="bottom", ~33 px de alto con la escala activa): arriba el globo
 * la esquiva; abajo casi no necesita aire; a los costados va a la altura de la
 * píldora, corrido medio ancho de píldora.
 */
const POPUP_OFFSET: Partial<Record<PopupAnchor, [number, number]>> = {
  bottom: [0, -40],
  "bottom-left": [0, -40],
  "bottom-right": [0, -40],
  top: [0, 8],
  "top-left": [0, 8],
  "top-right": [0, 8],
  left: [52, -16],
  right: [-52, -16],
  center: [0, 0],
};
type PopupAnchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Cuánto sigue abierta la vista previa después de sacar el mouse de la
 * píldora: lo justo para cruzar el hueco hasta el globo y poder tocarlo.
 */
const HOVER_GRACE_MS = 220;

function isLocated(l: CatalogListing): l is Located {
  return (
    typeof l.latitude === "number" &&
    typeof l.longitude === "number" &&
    Number.isFinite(l.latitude) &&
    Number.isFinite(l.longitude) &&
    !(l.latitude === 0 && l.longitude === 0)
  );
}

/** Texto de la píldora: el mismo número que muestra la tarjeta. */
export function pillLabel(listing: CatalogListing, view: SearchMode, stay?: StayInput): string {
  const p = cardPrice(listing, view, stay);
  if (p.kind === "total") return formatCurrency(p.total, p.currency);
  if (p.kind === "amount") return formatCurrency(p.amount, p.currency);
  return "Consultar";
}

/** Retoca light-v11 con la paleta de la marca (si una capa no existe, sigue). */
function paintBrand(map: ReturnType<MapRef["getMap"]>) {
  const set = (layer: string, prop: string, value: unknown) => {
    try {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never);
    } catch {
      /* capa con otra forma en otra versión del estilo: se deja como está */
    }
  };
  set("land", "background-color", MAP_COLORS.land);
  set("water", "fill-color", MAP_COLORS.water);
  set("waterway", "line-color", MAP_COLORS.water);
  set("national-park", "fill-color", MAP_COLORS.green);
  set("landuse", "fill-color", [
    "match",
    ["get", "class"],
    ["park", "grass", "pitch", "cemetery", "wood", "scrub", "agriculture"],
    MAP_COLORS.green,
    MAP_COLORS.landuseOther,
  ]);
  set("building", "fill-color", MAP_COLORS.building);
}

/**
 * Mapa de resultados (react-map-gl, se carga lazy). Píldoras de precio
 * crema/forest; la activa (hover en la grilla o elegida) en coral. Se ajusta
 * a los resultados cada vez que cambia el conjunto.
 */
export function ListingsMap({
  listings,
  view,
  stay,
  hoverStore,
  popups = true,
  onSelect,
  className,
}: ListingsMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Lo que se ve del mapa (para no abrir una vista previa de un punto que quedó afuera).
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);
  const hovered = useHoveredId(hoverStore);

  const located = useMemo(() => listings.filter(isLocated), [listings]);
  const idsKey = useMemo(() => located.map((l) => l.id).join(","), [located]);

  // El globo muestra la vista previa de lo que está bajo el mouse (una tarjeta
  // de la grilla o una píldora del mapa) y, si no hay nada, lo que se eligió
  // con un clic. Una tarjeta cuyo punto quedó fuera del mapa sólo resalta su
  // píldora: un globo cortado en el borde no sirve.
  const hoveredListing = located.find((l) => l.id === hovered);
  const hoverPreview =
    hoveredListing && bounds?.contains([hoveredListing.longitude, hoveredListing.latitude]) ? hoveredListing : null;
  const popupListing = popups ? (hoverPreview ?? located.find((l) => l.id === selected) ?? null) : null;

  // Al salir de una píldora la vista previa espera un instante antes de
  // cerrarse, para poder llevar el mouse hasta el globo y tocarlo; entrar al
  // globo (o a otra píldora) cancela el cierre.
  const leaveTimer = useRef<number | null>(null);
  const cancelLeave = () => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  // Sólo se cierra si lo activo sigue siendo lo que se dejó: si en el medio el
  // mouse entró a una tarjeta de la grilla, la vista previa nueva se respeta.
  const leaveSoon = (id: string) => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      if (hoverStore.get() === id) hoverStore.set(null);
    }, HOVER_GRACE_MS);
  };
  useEffect(
    () => () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // Encuadre inicial: los resultados que haya al montar (o el centro).
  const [initialView] = useState(() => {
    const b = boundsOf(located);
    return b
      ? { bounds: b, fitBoundsOptions: { padding: 64, maxZoom: 15 } }
      : { ...CORDOBA_CENTER, zoom: 12.5 };
  });

  // Re-encuadre cuando cambia el CONJUNTO de resultados (no en cada render).
  const fittedKey = useRef(idsKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || fittedKey.current === idsKey) return;
    fittedKey.current = idsKey;
    const b = boundsOf(located);
    if (!b) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(b, { padding: 64, maxZoom: 15, duration: reduce ? 0 : 700 });
  }, [loaded, idsKey, located]);

  if (!MAPBOX_TOKEN) return null;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-cream-200", className)}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={initialView}
        mapStyle="mapbox://styles/mapbox/light-v11"
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        cooperativeGestures={false}
        onLoad={(e) => {
          paintBrand(e.target);
          setLoaded(true);
          setBounds(e.target.getBounds());
        }}
        onMoveEnd={(e) => setBounds(e.target.getBounds())}
        onClick={() => setSelected(null)}
      >
        <NavigationControl
          position="top-right"
          showCompass={false}
          // Hoja del mapa en celular (sin popups): los botones de zoom quedaban
          // debajo de "Ver lista"; bajan por debajo de esa fila. Escritorio igual.
          style={popups ? undefined : { marginTop: "calc(4rem + env(safe-area-inset-top, 0px))" }}
        />
        {located.map((l) => {
          const active = hovered === l.id || selected === l.id;
          const label = pillLabel(l, view, stay);
          return (
            <Marker
              key={l.id}
              latitude={l.latitude}
              longitude={l.longitude}
              anchor="bottom"
              style={{ zIndex: active ? 3 : 1 }}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelected((prev) => (popups && prev === l.id ? null : l.id));
                onSelect?.(l.id);
              }}
            >
              <button
                type="button"
                aria-label={`${l.display_title}, ${label}`}
                aria-pressed={selected === l.id}
                onPointerEnter={() => {
                  cancelLeave();
                  hoverStore.set(l.id);
                }}
                onPointerLeave={() => leaveSoon(l.id)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 font-apart text-[0.8125rem] font-bold tabular-nums shadow-apart-md ring-1 outline-none",
                  "transition-[transform,background-color,color] duration-200 focus-visible:ring-[3px] focus-visible:ring-forest-500/50",
                  active
                    ? "scale-110 bg-coral-700 text-white ring-coral-700"
                    : "bg-paper text-forest-800 ring-forest-700/20 hover:scale-105",
                )}
              >
                {label}
              </button>
            </Marker>
          );
        })}

        {popupListing ? (
          <Popup
            latitude={popupListing.latitude}
            longitude={popupListing.longitude}
            // Sin `anchor`: Mapbox elige el lado donde el globo entra en el mapa.
            offset={POPUP_OFFSET}
            closeButton={false}
            closeOnClick={false}
            // Abrirse al pasar el mouse no puede mover el foco (ni scrollear la página).
            focusAfterOpen={false}
            onClose={() => setSelected(null)}
            maxWidth="264px"
            // Siempre por encima de las píldoras (z-index 1, y 3 la activa).
            style={{ zIndex: 20 }}
            className={cn(
              "[&_.mapboxgl-popup-content]:overflow-hidden [&_.mapboxgl-popup-content]:rounded-3xl [&_.mapboxgl-popup-content]:bg-paper",
              "[&_.mapboxgl-popup-content]:p-0 [&_.mapboxgl-popup-content]:shadow-apart-lg",
              // La punta del globo, del color de la tarjeta según hacia dónde apunte.
              "[&.mapboxgl-popup-anchor-bottom_.mapboxgl-popup-tip]:border-t-paper! [&.mapboxgl-popup-anchor-bottom-left_.mapboxgl-popup-tip]:border-t-paper! [&.mapboxgl-popup-anchor-bottom-right_.mapboxgl-popup-tip]:border-t-paper!",
              "[&.mapboxgl-popup-anchor-top_.mapboxgl-popup-tip]:border-b-paper! [&.mapboxgl-popup-anchor-top-left_.mapboxgl-popup-tip]:border-b-paper! [&.mapboxgl-popup-anchor-top-right_.mapboxgl-popup-tip]:border-b-paper!",
              "[&.mapboxgl-popup-anchor-left_.mapboxgl-popup-tip]:border-r-paper! [&.mapboxgl-popup-anchor-right_.mapboxgl-popup-tip]:border-l-paper!",
            )}
          >
            {/* Mientras el mouse está sobre el globo, la vista previa no se cierra. */}
            <div onPointerEnter={cancelLeave} onPointerLeave={() => leaveSoon(popupListing.id)}>
              <MiniCard listing={popupListing} view={view} stay={stay} />
            </div>
          </Popup>
        ) : null}
      </Map>
    </div>
  );
}

function boundsOf(list: Located[]): [[number, number], [number, number]] | null {
  if (list.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const l of list) {
    minLng = Math.min(minLng, l.longitude);
    maxLng = Math.max(maxLng, l.longitude);
    minLat = Math.min(minLat, l.latitude);
    maxLat = Math.max(maxLat, l.latitude);
  }
  // Un solo punto (o todos en el mismo edificio): abrir un poco la caja.
  const pad = 0.004;
  if (maxLng - minLng < pad) {
    minLng -= pad;
    maxLng += pad;
  }
  if (maxLat - minLat < pad) {
    minLat -= pad;
    maxLat += pad;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Tarjeta mini del popup (desktop). */
function MiniCard({ listing, view, stay }: { listing: CatalogListing; view: SearchMode; stay?: StayInput }) {
  const price = cardPrice(listing, view, stay);
  const cover = listing.photo_urls[0] ?? listing.cover_url;
  const capacity = [bedroomsLabel(listing.bedrooms), guestsLabel(listing.max_guests)].filter(Boolean).join(" · ");
  return (
    <Link
      href={listingHref(listing.slug, stay)}
      className="block w-64 font-apart outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/40"
    >
      <div className="relative aspect-[4/3] w-full bg-cream-200">
        {cover ? (
          <Image src={cover} alt="" fill sizes="256px" className="object-cover" />
        ) : null}
      </div>
      <div className="space-y-0.5 px-4 pb-4 pt-3">
        {listing.hood ? <p className="truncate text-[0.75rem] text-ink-500">{listing.hood}</p> : null}
        <p className="truncate text-[0.9375rem] font-bold text-forest-700">{listing.display_title}</p>
        {capacity ? <p className="truncate text-[0.8125rem] text-ink-600">{capacity}</p> : null}
        <p className="pt-1 text-[0.875rem] tabular-nums text-ink-900">
          {price.kind === "total" ? (
            <>
              <span className="font-bold">{formatCurrency(price.total, price.currency)}</span> total ·{" "}
              {nightsLabel(price.nights)}
            </>
          ) : price.kind === "amount" ? (
            <>
              <span className="font-bold">{formatCurrency(price.amount, price.currency)}</span>{" "}
              {price.per === "mes" ? "mes" : "noche"}
            </>
          ) : (
            <span className="font-semibold text-forest-700">Precio a consultar</span>
          )}
        </p>
      </div>
    </Link>
  );
}

export default ListingsMap;
