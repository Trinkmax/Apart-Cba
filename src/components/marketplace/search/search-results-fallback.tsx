"use client";

import { Map as MapIcon } from "lucide-react";
import type { StorefrontCatalog } from "@/lib/marketplace/contracts";
import { EMPTY_SEARCH, filterCatalog, hoodCounts, sortListings } from "@/lib/marketplace/catalog-filter";
import { whatsappLink } from "@/lib/marketplace/display";
import { cn } from "@/lib/utils";
import { ListingCard } from "../listing-card";
import { SearchEmptyState } from "./empty-state";
import { HoodChips } from "./hood-chips";
import { MAP_ENABLED } from "./map-config";
import { SearchToolbar } from "./search-toolbar";

function noop() {}

/**
 * /buscar como lo ve quien entra sin filtros ("Por noches", todo el catálogo),
 * dibujado en el servidor. Es el fallback del Suspense de SearchResultsClient:
 * ése lee la URL con useSearchParams y en una página estática se dibuja recién
 * en el cliente, así que sin esto el HTML era un esqueleto (sin H1, sin
 * tarjetas ni links para buscadores, sin JS ni primer pintado con contenido).
 *
 * Misma cuenta (filterCatalog/sortListings sobre EMPTY_SEARCH) y misma
 * geometría que el estado por defecto del cliente, que lo reemplaza al hidratar
 * sin que salte nada. Los controles son los reales, pero inertes: este HTML no
 * se hidrata (React lo descarta y monta el cliente), así que no hace falta
 * cablearlos. Con la URL con filtros, el cliente pinta encima el resultado real.
 *
 * El mapa de escritorio depende del ancho (useMediaQuery en el cliente); acá se
 * resuelve con CSS: la columna del mapa y la grilla de 2 columnas sólo desde lg.
 */
export function SearchResultsFallback({
  catalog,
  whatsappNumber,
}: {
  catalog: StorefrontCatalog;
  whatsappNumber: string | null;
}) {
  const state = EMPTY_SEARCH;
  const results = sortListings(filterCatalog(catalog.listings, state), state);
  const counts = hoodCounts(catalog.listings, state, null);
  const n = results.length;
  const heading = `${n} ${n === 1 ? "lugar" : "lugares"} en Córdoba`;

  return (
    <>
      <SearchToolbar
        state={state}
        view="noche"
        filterCount={0}
        onChange={noop}
        onOpenFilters={noop}
        editorOpen={false}
        onEditorOpenChange={noop}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={cn(MAP_ENABLED && "lg:grid lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:gap-8")}>
          <section aria-labelledby="buscar-titulo" className="min-w-0 pb-24 pt-4 lg:pb-16">
            <HoodChips hoods={catalog.hoods} counts={counts} total={n} value={null} onChange={noop} />

            <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <h1
                  id="buscar-titulo"
                  aria-live="polite"
                  className="font-apart text-[1.625rem] font-extrabold leading-[1.1] tracking-[-0.025em] text-forest-700 sm:text-[1.875rem]"
                >
                  {heading}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <SortSelectStatic />
                {MAP_ENABLED && n > 0 ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-cream-400 bg-paper px-4 font-apart text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors hover:border-forest-700/45 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 lg:hidden"
                  >
                    <MapIcon aria-hidden className="size-[1.1rem]" />
                    Mapa
                  </button>
                ) : null}
              </div>
            </div>

            {n === 0 ? (
              <SearchEmptyState
                onClearFilters={null}
                onChangeDates={null}
                whatsappUrl={whatsappLink(whatsappNumber, "Hola, estoy buscando lugar en Córdoba. ¿Me ayudan a encontrar algo?")}
              />
            ) : (
              <ul
                className={cn(
                  "mt-6 grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2",
                  MAP_ENABLED ? "2xl:grid-cols-3" : "lg:grid-cols-3",
                )}
              >
                {results.map((listing, i) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} view="noche" stay={null} priority={i < 4} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {MAP_ENABLED ? (
            <aside aria-hidden className="hidden lg:block">
              <div className="sticky top-[calc(72px+69px)] h-[calc(100dvh-72px-69px)] py-4">
                <div className="h-full w-full rounded-3xl bg-cream-200 shadow-apart-sm ring-1 ring-cream-300" />
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {MAP_ENABLED && n > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center safe-bottom lg:hidden">
          <button
            type="button"
            aria-haspopup="dialog"
            className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-forest-700 px-5 font-apart text-[0.9375rem] font-bold text-cream shadow-apart-lg outline-none transition-transform active:scale-[0.97] focus-visible:ring-[3px] focus-visible:ring-forest-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <MapIcon aria-hidden className="size-[1.1rem]" />
            Ver mapa
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Mismo markup que SortSelect de search-results-client.tsx, en "Recomendados". */
function SortSelectStatic() {
  return (
    <label className="relative inline-flex items-center gap-2 font-apart text-[0.875rem] text-ink-600">
      <span className="sr-only sm:not-sr-only">Ordenar</span>
      <select
        defaultValue="recomendado"
        className="h-11 cursor-pointer appearance-none rounded-full border border-cream-400 bg-paper pl-4 pr-10 text-[0.9375rem] font-semibold text-forest-700 outline-none transition-colors hover:border-forest-700/45 focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
      >
        <option value="recomendado">Recomendados</option>
        <option value="precio_asc">Menor precio</option>
        <option value="precio_desc">Mayor precio</option>
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-4 top-1/2 size-3.5 -translate-y-1/2 text-forest-700"
      >
        <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </label>
  );
}
