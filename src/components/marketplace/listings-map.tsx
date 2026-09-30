"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, X, Zap } from "lucide-react";
import Map, { Marker, NavigationControl, type MapRef } from "react-map-gl/mapbox";
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
import { placePreview } from "@/components/marketplace/search/map-preview-placement";
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
 * Cuánto sigue abierta la vista previa después de sacar el mouse de la
 * píldora: lo justo para cruzar el hueco hasta la tarjeta y poder tocarla.
 */
const HOVER_GRACE_MS = 220;

/**
 * Por debajo de este alto de mapa la tarjeta va compacta (foto más baja): con
 * la foto 16:10 (~267 px de alto) un mapa bajo no tiene lugar ni arriba ni
 * abajo del precio para la mitad de los puntos; compacta (~215 px) sí.
 */
const COMPACT_BELOW_PX = 640;

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
  const hovered = useHoveredId(hoverStore);

  const located = useMemo(() => listings.filter(isLocated), [listings]);
  const idsKey = useMemo(() => located.map((l) => l.id).join(","), [located]);

  // El globo muestra la vista previa de lo que está bajo el mouse (una tarjeta
  // de la grilla o una píldora del mapa) y, si no hay nada, lo que se eligió
  // con un clic. Una tarjeta cuyo punto quedó fuera del mapa sólo resalta su
  // píldora: un globo cortado en el borde no sirve.
  // Si el mouse está sobre la PÍLDORA (del mapa) o se eligió con un clic, la
  // vista previa va siempre. Si viene de una tarjeta de la grilla y su punto
  // quedó fuera de lo que se ve del mapa, sólo se resalta la píldora (eso lo
  // decide `positionPreview` con la posición real en pantalla, en vivo).
  const [pillHoverId, setPillHoverId] = useState<string | null>(null);
  const popupListing = popups
    ? (located.find((l) => l.id === hovered) ?? located.find((l) => l.id === selected) ?? null)
    : null;
  const anchored = popupListing != null && (pillHoverId === popupListing.id || selected === popupListing.id);

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

  // La vista previa NO es un popup de Mapbox: es una tarjeta propia encima del
  // mapa, que se ubica con `placePreview` (arriba del precio, abajo o a un
  // costado; siempre entera adentro del mapa). El popup de Mapbox elegía el
  // lado sin mirar si entraba (quedaba cortado) y su CSS, que no está en una
  // capa, le ganaba a los estilos de Tailwind. Se posiciona tocando el DOM
  // directo: al arrastrar el mapa no se re-renderiza nada.
  const wrapRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const positionPreview = () => {
    const map = mapRef.current;
    const wrap = wrapRef.current;
    const box = previewRef.current;
    const inner = innerRef.current;
    if (!map || !wrap || !box || !inner || !popupListing) return;
    // Primero el tamaño (compacta en mapas bajos) y recién después se mide.
    box.dataset.compact = wrap.clientHeight < COMPACT_BELOW_PX ? "true" : "false";
    const p = map.project([popupListing.longitude, popupListing.latitude]);
    // Desde la grilla, con el punto fuera del mapa: nada (una tarjeta que no
    // señala a ningún lado confunde). Vuelve sola si se mueve el mapa.
    const offScreen = p.x < 0 || p.y < 0 || p.x > wrap.clientWidth || p.y > wrap.clientHeight;
    if (box.dataset.anchored !== "true" && offScreen) {
      box.style.visibility = "hidden";
      return;
    }
    const res = placePreview({
      point: { x: p.x, y: p.y },
      card: { width: box.offsetWidth, height: box.offsetHeight },
      container: { width: wrap.clientWidth, height: wrap.clientHeight },
    });
    box.style.transform = `translate3d(${Math.round(res.left)}px, ${Math.round(res.top)}px, 0)`;
    box.style.visibility = "visible";
    // Sin flecha: una punta color papel quedaba suelta sobre la foto o se
    // perdía contra las píldoras blancas. La tarjeta flota al lado del precio
    // (que queda en coral) y su entrada "crece" desde el lado que lo mira.
    const o = res.anchor ?? (res.side === "top" || res.side === "bottom" ? box.offsetWidth / 2 : box.offsetHeight / 2);
    inner.style.transformOrigin =
      res.side === "top"
        ? `${o}px 100%`
        : res.side === "bottom"
          ? `${o}px 0`
          : res.side === "left"
            ? `100% ${o}px`
            : `0 ${o}px`;
  };
  // Después de cada render (cambió la unidad, el tamaño o se abrió): antes de pintar.
  useLayoutEffect(() => {
    positionPreview();
  });

  const closePreview = () => {
    cancelLeave();
    setSelected(null);
    hoverStore.set(null);
  };

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
    <div ref={wrapRef} className={cn("relative h-full w-full overflow-hidden bg-cream-200", className)}>
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
        }}
        onMove={positionPreview}
        onResize={positionPreview}
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
                  setPillHoverId(l.id);
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

      </Map>

      {popupListing ? (
        // Encima del mapa y de las píldoras (z-index 1, 3 la activa). Arranca
        // invisible y `positionPreview` la ubica antes de pintar. Mientras el
        // mouse está sobre la tarjeta, la vista previa no se cierra.
        <div
          ref={previewRef}
          role="group"
          aria-label={`Vista previa: ${popupListing.display_title}`}
          className="group/preview absolute left-0 top-0 z-20 w-[15.5rem] font-apart"
          data-anchored={anchored ? "true" : "false"}
          style={{ visibility: "hidden" }}
          onPointerEnter={cancelLeave}
          onPointerLeave={() => leaveSoon(popupListing.id)}
          onKeyDown={(e) => {
            if (e.key === "Escape") closePreview();
          }}
        >
          <div
            key={popupListing.id}
            ref={innerRef}
            className="relative motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          >
            <PreviewCard
              listing={popupListing}
              view={view}
              stay={stay}
              onClose={selected === popupListing.id ? closePreview : undefined}
            />
          </div>
        </div>
      ) : null}
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

/**
 * La tarjeta de la vista previa (escritorio): foto a sangre con el barrio en
 * una pastilla, nombre, capacidad, precio y "Ver" hacia la ficha. Si se abrió
 * con un clic (no por pasar el mouse) lleva una cruz para cerrarla.
 */
function PreviewCard({
  listing,
  view,
  stay,
  onClose,
}: {
  listing: CatalogListing;
  view: SearchMode;
  stay?: StayInput;
  onClose?: () => void;
}) {
  const price = cardPrice(listing, view, stay);
  const cover = listing.photo_urls[0] ?? listing.cover_url;
  const capacity = [bedroomsLabel(listing.bedrooms), guestsLabel(listing.max_guests)].filter(Boolean).join(" · ");
  return (
    <div className="relative overflow-hidden rounded-[1.25rem] bg-paper shadow-[0_24px_48px_-16px_rgb(15_66_56/0.45),0_4px_12px_-4px_rgb(15_66_56/0.18)] ring-1 ring-forest-900/10">
      <Link
        href={listingHref(listing.slug, stay)}
        className="group block outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/40"
      >
        <div className="relative aspect-[16/10] overflow-hidden bg-cream-200 group-data-[compact=true]/preview:aspect-[2/1]">
          {cover ? (
            <Image
              src={cover}
              alt=""
              fill
              sizes="248px"
              className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.05]"
            />
          ) : null}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-forest-950/40 to-transparent"
          />
          {listing.hood ? (
            <span className="absolute left-2.5 top-2.5 max-w-[calc(100%-3.75rem)] truncate rounded-full bg-paper/95 px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-forest-700 shadow-apart-sm backdrop-blur">
              {listing.hood}
            </span>
          ) : null}
          {listing.instant_book ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-forest-700/90 px-2 py-0.5 text-[0.6875rem] font-semibold text-cream backdrop-blur">
              <Zap className="size-3" aria-hidden />
              Reserva inmediata
            </span>
          ) : null}
        </div>
        <div className="px-4 pb-3.5 pt-3 group-data-[compact=true]/preview:pb-3 group-data-[compact=true]/preview:pt-2.5">
          <p className="truncate text-base font-extrabold leading-tight tracking-[-0.015em] text-forest-700">
            {listing.display_title}
          </p>
          {capacity ? <p className="mt-1 truncate text-[0.8125rem] text-ink-500">{capacity}</p> : null}
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-cream-300 pt-2.5 group-data-[compact=true]/preview:mt-2 group-data-[compact=true]/preview:pt-2">
            <p className="min-w-0 truncate text-[0.875rem] tabular-nums text-ink-700">
              {price.kind === "total" ? (
                <>
                  <span className="font-extrabold text-ink-900">{formatCurrency(price.total, price.currency)}</span> total ·{" "}
                  {nightsLabel(price.nights)}
                </>
              ) : price.kind === "amount" ? (
                <>
                  <span className="font-extrabold text-ink-900">{formatCurrency(price.amount, price.currency)}</span>{" "}
                  {price.per === "mes" ? "mes" : "noche"}
                </>
              ) : (
                <span className="font-semibold text-forest-700">Precio a consultar</span>
              )}
            </p>
            <span className="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-bold text-coral-700">
              Ver
              <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </span>
          </div>
        </div>
      </Link>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar la vista previa"
          className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-paper/95 text-forest-700 shadow-apart-sm backdrop-blur transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export default ListingsMap;
