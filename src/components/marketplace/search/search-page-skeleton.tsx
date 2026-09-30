import { ListingCardSkeleton } from "@/components/marketplace/listing-card";

/**
 * Esqueleto de /buscar (fallback del Suspense y loading.tsx): misma geometría
 * que la barra sticky, los chips, el título y la grilla, para que no salte.
 */
export function SearchPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando lugares">
      <div className="sticky top-16 z-30 border-b border-cream-300 bg-cream/95 lg:top-[72px] max-lg:shadow-[0_10px_24px_-20px_rgb(6_32_27/0.45)]">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8 max-lg:py-2">
          <div className="h-12 min-w-0 flex-1 rounded-full bg-paper ring-1 ring-cream-300 sm:max-w-md" />
          <div className="h-12 w-40 shrink-0 rounded-full bg-cream-200 ring-1 ring-inset ring-cream-300 sm:w-56" />
          <div className="size-11 shrink-0 rounded-full border border-cream-400 bg-paper sm:ml-auto sm:w-28" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6 lg:px-8 motion-safe:animate-pulse max-lg:pb-4 max-lg:pt-3">
        <div className="flex gap-2 overflow-hidden py-1">
          {[88, 136, 112, 150, 120, 104].map((w, i) => (
            <div key={i} className="h-11 shrink-0 rounded-full bg-paper ring-1 ring-inset ring-cream-300" style={{ width: w }} />
          ))}
        </div>
        {/* < lg: título corto, orden y mapa en una sola línea (como la página). */}
        <div className="mt-5 flex items-end justify-between gap-4 max-lg:mt-4 max-lg:items-center max-lg:gap-2">
          <div className="h-8 w-64 max-w-[70%] rounded-full bg-cream-300/70 max-sm:h-7 max-sm:w-28" />
          <div className="h-11 w-40 rounded-full border border-cream-400 bg-paper max-sm:w-52" />
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 max-lg:mt-4">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <ListingCardSkeleton className="motion-safe:animate-none" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
