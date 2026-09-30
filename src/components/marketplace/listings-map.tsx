"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, X, Zap } from "lucide-react";
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
import { ApartLogo } from "@/components/marketplace/brand/apart-logo";
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

/** Medida aproximada de una píldora de precio ("$ 110.000"). */
const PILL = { width: 88, height: 34 } as const;

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

  // La vista previa muestra lo que está bajo el mouse (una tarjeta de la
  // grilla o una píldora del mapa) y, si no hay nada, lo que se eligió con un
  // clic. Desde la píldora o con un clic va siempre ("anclada"); desde la
  // grilla, si el punto quedó fuera de lo que se ve del mapa, sólo se resalta
  // la píldora (lo decide `positionPreview` con la posición real, en vivo).
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
      setPillHoverId((cur) => (cur === id ? null : cur));
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
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    // Una tarjeta que no señala a ningún lado confunde: desde la grilla hace
    // falta el punto adentro del mapa; anclada (píldora o clic), que se vea
    // algo de la píldora. Si no, se oculta y vuelve sola al mover el mapa.
    const visible =
      box.dataset.anchored === "true"
        ? p.x + PILL.width / 2 > 0 && p.x - PILL.width / 2 < W && p.y > 0 && p.y - PILL.height < H
        : p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
    if (!visible) {
      box.style.visibility = "hidden";
      return;
    }
    const res = placePreview({
      point: { x: p.x, y: p.y },
      card: { width: box.offsetWidth, height: box.offsetHeight },
      container: { width: W, height: H },
      pill: PILL,
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
          className="group/preview absolute left-0 top-0 z-20 w-64 font-apart"
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

/** Mismo alto de foto en la tarjeta y en la capa de controles que va encima. */
const PREVIEW_PHOTO = "aspect-[16/10] group-data-[compact=true]/preview:aspect-[2/1]";
const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * La tarjeta de la vista previa (escritorio), con el lenguaje de las tarjetas
 * de la grilla: fotos que se deslizan (flechas al pasar el mouse, puntos
 * abajo), el barrio en una pastilla, nombre, capacidad y precio, y una flecha
 * coral hacia la ficha (toda la tarjeta es el link). Las flechas y la cruz (sólo si se abrió con un clic) van ENCIMA
 * del link, como hermanos: nunca un botón adentro de un <a>.
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
  const photos = listing.photo_urls.length > 0 ? listing.photo_urls : listing.cover_url ? [listing.cover_url] : [];
  const [index, setIndex] = useState(0);
  // Al abrirse sólo pide red la primera foto; las demás, cuando hay intención
  // (el mouse entra a la tarjeta, una flecha, un deslizamiento).
  const [mountedUpTo, setMountedUpTo] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const price = cardPrice(listing, view, stay);
  const capacity = [bedroomsLabel(listing.bedrooms), guestsLabel(listing.max_guests)].filter(Boolean).join(" · ");

  const warmUpTo = (i: number) => setMountedUpTo((m) => Math.max(m, Math.min(i, photos.length - 1)));

  const handleScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const next = Math.round(el.scrollLeft / el.clientWidth);
      warmUpTo(next + 1);
      setIndex((prev) => (prev === next ? prev : next));
    });
  };

  const go = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const next = Math.min(Math.max(index + dir, 0), photos.length - 1);
    warmUpTo(next + 1);
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div
      onPointerEnter={() => warmUpTo(1)}
      className="relative overflow-hidden rounded-[1.375rem] bg-paper shadow-[0_28px_56px_-18px_rgb(15_66_56/0.5),0_6px_16px_-6px_rgb(15_66_56/0.2)] ring-1 ring-forest-900/10"
    >
      <Link
        href={listingHref(listing.slug, stay)}
        className="group block outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-forest-500/40"
      >
        <div className={cn("relative overflow-hidden bg-cream-200", PREVIEW_PHOTO)}>
          {photos.length > 0 ? (
            <div
              ref={trackRef}
              onScroll={handleScroll}
              className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            >
              {photos.map((src, i) => (
                <div key={`${src}-${i}`} className="relative h-full w-full shrink-0 snap-start snap-always">
                  {i <= mountedUpTo ? (
                    <Image
                      src={src}
                      alt={i === 0 ? `Foto de ${listing.display_title}` : ""}
                      fill
                      sizes="256px"
                      loading={i > 0 ? "eager" : undefined}
                      draggable={false}
                      className={cn(
                        "object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.04]",
                        EASE,
                      )}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-leaf-100">
              <ApartLogo variant="symbol" title={null} className="h-10 text-leaf-400" />
            </div>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-forest-950/35 to-transparent"
          />
          {listing.hood ? (
            <span className="absolute left-2.5 top-2.5 max-w-[calc(100%-3.75rem)] truncate rounded-full bg-paper/95 px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-forest-700 shadow-apart-sm backdrop-blur">
              {listing.hood}
            </span>
          ) : null}
          {photos.length > 1 ? (
            <span aria-hidden className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full bg-paper shadow-[0_0_2px_rgb(6_32_27/0.4)] transition-all duration-300",
                    i === index ? "w-4 opacity-100" : "w-1.5 opacity-60",
                  )}
                />
              ))}
            </span>
          ) : null}
        </div>

        <div className="px-4 pb-3.5 pt-3 group-data-[compact=true]/preview:pb-3 group-data-[compact=true]/preview:pt-2.5">
          <p className="truncate text-base font-extrabold leading-tight tracking-[-0.015em] text-forest-700">
            {listing.display_title}
            {listing.display_tagline ? (
              <span className="font-apart-serif text-[0.875rem] font-normal italic tracking-normal text-ink-500">
                {" "}
                · {listing.display_tagline}
              </span>
            ) : null}
          </p>
          {capacity ? <p className="mt-1 truncate text-[0.8125rem] text-ink-500">{capacity}</p> : null}
          {listing.instant_book ? (
            <p className="mt-1 inline-flex items-center gap-1 text-[0.75rem] font-bold text-forest-600">
              <Zap aria-hidden className="size-3 fill-leaf-300 stroke-forest-600" />
              Reserva inmediata
            </p>
          ) : null}
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-cream-300 pt-2.5 group-data-[compact=true]/preview:mt-2 group-data-[compact=true]/preview:pt-2">
            <PreviewPrice price={price} />
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-coral-700 text-white shadow-[0_8px_16px_-8px_rgb(166_61_42/0.8)] transition-colors duration-200 group-hover:bg-coral-800"
            >
              <ArrowRight
                className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            </span>
          </div>
        </div>
      </Link>

      {/* Encima del link (hermanos, no hijos): flechas de las fotos y la cruz. */}
      <div className={cn("pointer-events-none absolute inset-x-0 top-0", PREVIEW_PHOTO)}>
        {photos.length > 1 ? (
          <>
            <PreviewArrow dir={-1} hidden={index === 0} onClick={() => go(-1)} />
            <PreviewArrow dir={1} hidden={index >= photos.length - 1} onClick={() => go(1)} />
          </>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar la vista previa"
            className="pointer-events-auto absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-paper/95 text-forest-700 shadow-apart-sm backdrop-blur transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PreviewPrice({ price }: { price: ReturnType<typeof cardPrice> }) {
  if (price.kind === "consult") {
    return <p className="min-w-0 truncate text-[0.875rem] font-semibold text-forest-700">Precio a consultar</p>;
  }
  if (price.kind === "total") {
    return (
      <div className="min-w-0 tabular-nums">
        <p className="truncate text-[0.875rem] text-ink-700">
          <span className="text-base font-extrabold text-ink-900">{formatCurrency(price.total, price.currency)}</span>{" "}
          total
        </p>
        <p className="truncate text-[0.75rem] text-ink-500">
          {nightsLabel(price.nights)} · {formatCurrency(price.nightly, price.currency)} noche
        </p>
      </div>
    );
  }
  return (
    <p className="min-w-0 truncate text-[0.875rem] tabular-nums text-ink-700">
      <span className="text-base font-extrabold text-ink-900">{formatCurrency(price.amount, price.currency)}</span>{" "}
      {price.per === "mes" ? "mes" : "noche"}
    </p>
  );
}

function PreviewArrow({ dir, hidden, onClick }: { dir: -1 | 1; hidden: boolean; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={dir < 0 ? "Foto anterior" : "Foto siguiente"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "pointer-events-auto absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full",
        "bg-paper/95 text-forest-700 shadow-apart-md transition-opacity duration-200 hover:bg-paper",
        "opacity-0 group-hover/preview:opacity-100",
        dir < 0 ? "left-2.5" : "right-2.5",
        hidden && "invisible",
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2.5} />
    </button>
  );
}

export default ListingsMap;
