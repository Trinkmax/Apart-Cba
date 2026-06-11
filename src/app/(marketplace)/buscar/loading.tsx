// Skeleton de /buscar — espeja chips de categorías + barra de filtros +
// grilla de resultados con mapa, para que la navegación no quede congelada
// durante el TTFB. Los cambios de filtros dentro de /buscar usan
// startTransition (SearchFiltersBar), así que este skeleton solo aparece
// al entrar a la página, no al ajustar filtros.
export default function Loading() {
  return (
    <div className="bg-white">
      {/* Chips de categorías */}
      <div className="border-b border-neutral-200/80 bg-white">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8">
          <div className="flex items-center gap-6 md:gap-9 overflow-hidden py-4 md:py-5 justify-start md:justify-center">
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 pb-2.5 shrink-0">
                <div className="h-[22px] w-[22px] rounded-lg bg-neutral-100 animate-pulse" />
                <div className="h-3 w-12 rounded-full bg-neutral-100 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="h-5 w-24 rounded-full bg-neutral-100 animate-pulse" />
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:block h-8 w-40 rounded-full bg-neutral-100 animate-pulse" />
            <div className="h-8 w-[88px] rounded-full bg-neutral-100 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Resultados + mapa — misma grilla que SearchResultsClient */}
      <div className="flex flex-col md:grid md:grid-cols-[1fr_minmax(0,500px)] xl:grid-cols-[1fr_minmax(0,560px)]">
        <div>
          <div className="max-w-[900px] px-4 md:px-8 py-6 md:py-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 md:gap-8">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="aspect-[4/3] bg-neutral-100 rounded-2xl animate-pulse" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-2/3 bg-neutral-100 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-neutral-100 rounded animate-pulse" />
                    <div className="h-3 w-1/3 bg-neutral-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hidden md:block h-[calc(100vh-140px)] bg-neutral-100 animate-pulse" />
      </div>
    </div>
  );
}
