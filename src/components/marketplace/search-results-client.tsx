"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Info, Map as MapIcon } from "lucide-react";
import { getCatalogAvailability } from "@/lib/actions/storefront";
import type { AvailabilityResult, StorefrontCatalog } from "@/lib/marketplace/contracts";
import {
  activeFilterCount,
  effectiveView,
  filterCatalog,
  guestsCountLabel,
  hoodCounts,
  parseSearchState,
  priceKey,
  rangeLabel,
  searchHref,
  searchRange,
  sortListings,
  type SearchSort,
  type SearchState,
} from "@/lib/marketplace/catalog-filter";
import { formatCurrency, todayIsoAR } from "@/lib/marketplace/pricing";
import { whatsappLink } from "@/lib/marketplace/display";
import { cn } from "@/lib/utils";
import { ListingCard, ListingCardSkeleton } from "./listing-card";
import { SearchEmptyState } from "./search/empty-state";
import { FiltersSheet } from "./search/filters-sheet";
import { HoodChips } from "./search/hood-chips";
import { createHoverStore } from "./search/hover-store";
import { rememberLastSearch } from "./search/last-search";
import { MAP_ENABLED } from "./search/map-config";
import { MobileMapSheet } from "./search/mobile-map-sheet";
import { SearchToolbar } from "./search/search-toolbar";
import { useMediaQuery } from "./search/stepper";

const ListingsMap = dynamic(() => import("./listings-map"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-full w-full rounded-3xl bg-cream-200 motion-safe:animate-pulse" />,
});

const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: "recomendado", label: "Recomendados" },
  { value: "precio_asc", label: "Menor precio" },
  { value: "precio_desc", label: "Mayor precio" },
];

type AvailState = { key: string; result: AvailabilityResult } | null;

/** Fechas pasadas en un link viejo: se ignoran (se busca sin fechas). */
function sanitize(state: SearchState, today: string): SearchState {
  if (state.checkIn && state.checkIn < today) {
    return { ...state, checkIn: null, checkOut: null, months: null };
  }
  return state;
}

/**
 * Cambia la URL sin navegar ni scrollear: Next sincroniza useSearchParams con
 * history.replaceState (equivale a router.replace sin ida y vuelta al server).
 * El estado va en null a propósito: si se pasa el de Next (marcado como
 * interno), el router NO se entera del cambio.
 */
function replaceUrl(next: SearchState) {
  window.history.replaceState(null, "", searchHref(next));
}

export type SearchResultsClientProps = {
  catalog: StorefrontCatalog;
  /** WhatsApp del equipo (dígitos con código de país) para el estado vacío. */
  whatsappNumber: string | null;
};

/**
 * /buscar en el cliente: lee la URL, filtra el catálogo entero (instantáneo),
 * chequea disponibilidad por fechas con `getCatalogAvailability` y sincroniza
 * todo de vuelta a la URL (compartible, sin scroll).
 */
export function SearchResultsClient({ catalog, whatsappNumber }: SearchResultsClientProps) {
  const params = useSearchParams();
  const [today] = useState(todayIsoAR);
  const state = useMemo(() => sanitize(parseSearchState(params), today), [params, today]);
  const { view, autoMonthly } = effectiveView(state);
  const range = searchRange(state);
  const availKey = range ? `${range.checkIn}_${range.checkOut}` : null;

  const [avail, setAvail] = useState<AvailState>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [hoverStore] = useState(createHoverStore);
  const isLg = useMediaQuery("(min-width: 1024px)");
  const showDesktopMap = MAP_ENABLED && isLg;
  const [mapHeadRef, mapEndRef, mapPillVisible] = useMapPillVisibility(MAP_ENABLED && !isLg);

  // "← Seguir buscando" de la ficha vuelve a esta búsqueda exacta.
  const currentHref = searchHref(state);
  useEffect(() => {
    rememberLastSearch(currentHref);
  }, [currentHref]);

  useEffect(() => {
    if (!availKey) return;
    const [checkIn, checkOut] = availKey.split("_");
    let cancelled = false;
    getCatalogAvailability({ checkIn, checkOut })
      .then((result) => {
        if (!cancelled) setAvail({ key: availKey, result });
      })
      .catch(() => {
        if (!cancelled) {
          setAvail({ key: availKey, result: { ok: false, error: "network" } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [availKey]);

  const current = avail && avail.key === availKey ? avail.result : null;
  const checking = Boolean(availKey) && !current;
  const availFailed = Boolean(current && !current.ok);
  const unavailable = useMemo(
    () => (current && current.ok ? new Set(current.unavailable) : null),
    [current],
  );

  const results = useMemo(
    () => sortListings(filterCatalog(catalog.listings, state, { unavailable }), state),
    [catalog.listings, state, unavailable],
  );
  const counts = useMemo(() => hoodCounts(catalog.listings, state, unavailable), [catalog.listings, state, unavailable]);
  const allHoodsTotal = useMemo(
    () => filterCatalog(catalog.listings, { ...state, hood: null }, { unavailable }).length,
    [catalog.listings, state, unavailable],
  );
  const priceHint = useMemo(() => {
    const values = catalog.listings
      .filter((l) => (view === "noche" ? l.offers_short : l.offers_monthly))
      .map((l) => priceKey(l, view, null))
      .filter((n): n is number => n != null && n > 0);
    if (values.length < 2) return null;
    const per = view === "mes" ? "por mes" : "por noche";
    return `Hoy van de ${formatCurrency(Math.min(...values))} a ${formatCurrency(Math.max(...values))} ${per}.`;
  }, [catalog.listings, view]);

  const filterCount = activeFilterCount(state);
  const stay = range ? { checkIn: range.checkIn, checkOut: range.checkOut, guests: state.guests ?? undefined } : null;
  const hasNarrowing = filterCount > 0 || state.hood != null || state.guests != null;
  const [editorOpen, setEditorOpen] = useState(false);

  const waText = [
    "Hola, estoy buscando lugar en Córdoba",
    range || state.guests
      ? ` (${[range ? rangeLabel(range.checkIn, range.checkOut) : null, state.guests ? guestsCountLabel(state.guests) : null]
          .filter(Boolean)
          .join(", ")})`
      : "",
    ". ¿Me ayudan a encontrar algo?",
  ].join("");
  const whatsappUrl = whatsappLink(whatsappNumber, waText);

  function update(next: SearchState) {
    replaceUrl(next);
  }

  function clearFilters() {
    update({ ...state, hood: null, bedrooms: null, priceMax: null, instant: false, guests: null });
  }

  function countFor(next: SearchState) {
    return filterCatalog(catalog.listings, next, { unavailable }).length;
  }

  const n = results.length;
  const heading = checking ? "Buscando lugares libres…" : `${n} ${n === 1 ? "lugar" : "lugares"} en Córdoba`;

  return (
    <>
      <SearchToolbar
        state={state}
        view={view}
        filterCount={filterCount}
        onChange={update}
        onOpenFilters={() => setFiltersOpen(true)}
        editorOpen={editorOpen}
        onEditorOpenChange={setEditorOpen}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={cn(showDesktopMap && "lg:grid lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:gap-8")}>
          {/* < lg: sin el colchón de abajo (quedaba un hueco grande antes del footer). */}
          <section aria-labelledby="buscar-titulo" className="min-w-0 pb-24 pt-4 lg:pb-16 max-lg:pb-4 max-lg:pt-3">
            <HoodChips
              hoods={catalog.hoods}
              counts={counts}
              total={allHoodsTotal}
              value={state.hood}
              onChange={(hood) => update({ ...state, hood })}
            />

            {autoMonthly ? (
              <Notice icon={<CalendarClock aria-hidden className="size-5" />}>
                <strong className="font-bold text-forest-700">Para 28 noches o más te mostramos estadías por mes.</strong>{" "}
                Se consultan: al escribirnos te pasamos el precio y la disponibilidad.
              </Notice>
            ) : view === "mes" ? (
              <Notice icon={<CalendarClock aria-hidden className="size-5" />}>
                <strong className="font-bold text-forest-700">Estadías por mes: se consultan.</strong> Te mostramos el
                precio de lista cuando lo hay; el final te lo confirmamos al consultar.
              </Notice>
            ) : null}
            {availFailed ? (
              <Notice icon={<Info aria-hidden className="size-5" />} tone="warn">
                No pudimos chequear la disponibilidad, confirmala en cada ficha.
              </Notice>
            ) : null}

            {/* < lg, una sola línea: título corto + orden + mapa. */}
            <div
              ref={mapHeadRef}
              className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 max-lg:mt-4 max-lg:flex-nowrap max-lg:items-center max-lg:gap-x-2"
            >
              <div className="min-w-0 max-lg:flex-1">
                <h1
                  id="buscar-titulo"
                  aria-live="polite"
                  aria-busy={checking || undefined}
                  className="font-apart text-[1.625rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 sm:text-[1.875rem] max-sm:text-[1.25rem] min-[375px]:max-sm:text-[1.375rem] max-lg:relative"
                >
                  {/* "en Córdoba" sigue para lectores y buscadores; a la vista sobra en celular (toda la web es Córdoba). */}
                  {checking ? (
                    <>
                      <span className="max-lg:hidden">Buscando lugares libres…</span>
                      <span className="lg:hidden">Buscando…</span>
                    </>
                  ) : (
                    <>
                      {n} {n === 1 ? "lugar" : "lugares"}
                      <span className="max-lg:sr-only"> en Córdoba</span>
                    </>
                  )}
                </h1>
                {/* < lg ya lo dice la píldora de la barra sticky. */}
                {stay ? (
                  <p className="mt-1 text-[0.9375rem] text-ink-600 max-lg:hidden">
                    {view === "mes" && state.mode === "mes" ? "Desde el " : ""}
                    {rangeLabel(stay.checkIn, stay.checkOut)}
                    {state.guests ? ` · ${guestsCountLabel(state.guests)}` : ""}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <SortSelect value={state.sort} onChange={(sort) => update({ ...state, sort })} />
                {MAP_ENABLED && !isLg && n > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMapOpen(true)}
                    aria-haspopup="dialog"
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-cream-400 bg-paper px-4 font-apart text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors hover:border-forest-700/45 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 lg:hidden max-sm:relative max-sm:w-11 max-sm:justify-center max-sm:px-0"
                  >
                    <MapIcon aria-hidden className="size-[1.1rem]" />
                    <span className="max-sm:sr-only">Mapa</span>
                  </button>
                ) : null}
              </div>
            </div>

            {checking ? (
              <ul aria-hidden className={gridClass(showDesktopMap)}>
                {Array.from({ length: Math.min(Math.max(results.length, 3), 9) }, (_, i) => (
                  <li key={i}>
                    <ListingCardSkeleton />
                  </li>
                ))}
              </ul>
            ) : n === 0 ? (
              <SearchEmptyState
                onClearFilters={hasNarrowing ? clearFilters : null}
                onChangeDates={range ? () => setEditorOpen(true) : null}
                whatsappUrl={whatsappUrl}
              />
            ) : (
              <ul className={gridClass(showDesktopMap)}>
                {results.map((listing, i) => (
                  <li
                    key={listing.id}
                    // .m-rise: sube y aparece al entrar (sólo < lg; en escritorio no hace nada).
                    className="m-rise"
                    onPointerEnter={() => hoverStore.set(listing.id)}
                    onPointerLeave={() => hoverStore.set(null)}
                    onFocus={() => hoverStore.set(listing.id)}
                    onBlur={() => hoverStore.set(null)}
                  >
                    <ListingCard
                      listing={listing}
                      view={view}
                      stay={stay}
                      priority={i < 4}
                      mobileBadge={view !== "mes"}
                    />
                  </li>
                ))}
              </ul>
            )}
            {/* Fin de la lista: al entrar a la pantalla se va el botón flotante del mapa. */}
            <div ref={mapEndRef} aria-hidden className="lg:hidden" />
          </section>

          {showDesktopMap ? (
            <aside aria-label="Mapa de resultados" className="hidden lg:block">
              <div className="sticky top-[calc(72px+69px)] h-[calc(100dvh-72px-69px)] py-4">
                <ListingsMap
                  listings={results}
                  view={view}
                  stay={stay}
                  hoverStore={hoverStore}
                  className="rounded-3xl shadow-apart-sm ring-1 ring-cream-300"
                />
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {MAP_ENABLED && !isLg && n > 0 && !checking ? (
        <div
          inert={!mapPillVisible}
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center safe-bottom lg:hidden",
            "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            mapPillVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
          )}
        >
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            aria-haspopup="dialog"
            className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-forest-700 px-5 font-apart text-[0.9375rem] font-bold text-cream shadow-apart-lg outline-none transition-transform active:scale-[0.97] focus-visible:ring-[3px] focus-visible:ring-forest-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <MapIcon aria-hidden className="size-[1.1rem]" />
            Ver mapa
          </button>
        </div>
      ) : null}

      {MAP_ENABLED && !isLg ? (
        <MobileMapSheet
          open={mapOpen}
          onOpenChange={setMapOpen}
          listings={results}
          view={view}
          stay={stay}
          hoverStore={hoverStore}
          title={heading}
          MapComponent={ListingsMap}
        />
      ) : null}

      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        state={state}
        view={view}
        countFor={countFor}
        onApply={update}
        priceHint={priceHint}
      />
    </>
  );
}

/**
 * Celular: el botón flotante "Ver mapa" aparece recién cuando la fila del
 * título (que ya tiene su botón de mapa) quedó debajo de las barras sticky, y
 * se va cuando entra el final de la lista (no tapa la última tarjeta ni el
 * footer). Así nunca hay dos botones de mapa a la vista.
 */
function useMapPillVisibility(enabled: boolean) {
  const headRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ headOut: false, endIn: false });

  useEffect(() => {
    const head = headRef.current;
    const end = endRef.current;
    if (!enabled || !head || !end || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        setState((prev) => {
          let { headOut, endIn } = prev;
          for (const e of entries) {
            const top = e.rootBounds?.top ?? 0;
            const bottom = e.rootBounds?.bottom ?? window.innerHeight;
            if (e.target === head) headOut = !e.isIntersecting && e.boundingClientRect.top < top;
            else endIn = e.boundingClientRect.top < bottom;
          }
          return headOut === prev.headOut && endIn === prev.endIn ? prev : { headOut, endIn };
        });
      },
      // Arriba, lo que tapan el header (64 px) y la barra de búsqueda.
      { rootMargin: "-128px 0px 0px 0px" },
    );
    io.observe(head);
    io.observe(end);
    return () => io.disconnect();
  }, [enabled]);

  return [headRef, endRef, enabled && state.headOut && !state.endIn] as const;
}

function gridClass(withMap: boolean) {
  return cn(
    "mt-6 grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 max-lg:mt-4",
    withMap ? "2xl:grid-cols-3" : "lg:grid-cols-3",
  );
}

function Notice({
  icon,
  children,
  tone = "info",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <div
      role={tone === "warn" ? "status" : undefined}
      className={cn(
        "mt-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-[0.9375rem] leading-snug",
        // < lg, más compacto: es un aviso, no tiene que empujar las fotos.
        "max-lg:mt-3 max-lg:gap-2.5 max-lg:px-3.5 max-lg:py-2.5 max-lg:text-[0.8125rem]",
        tone === "warn" ? "bg-coral-50 text-coral-800 ring-1 ring-inset ring-coral-200" : "bg-leaf-100 text-ink-800",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone === "warn" ? "text-coral-800" : "text-forest-600")}>{icon}</span>
      <p className="min-w-0">{children}</p>
    </div>
  );
}

function SortSelect({ value, onChange }: { value: SearchSort; onChange: (sort: SearchSort) => void }) {
  return (
    <label className="relative inline-flex items-center gap-2 font-apart text-[0.875rem] text-ink-600">
      <span className="sr-only sm:not-sr-only">Ordenar</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SearchSort)}
        className="h-11 cursor-pointer appearance-none rounded-full border border-cream-400 bg-paper pl-4 pr-10 text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors hover:border-forest-700/45 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 max-sm:pl-3 max-sm:pr-7"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-4 top-1/2 size-3.5 -translate-y-1/2 text-forest-700 max-sm:right-2.5"
      >
        <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </label>
  );
}
