// Skeleton del home del marketplace — se muestra al instante mientras el
// server renderiza (TTFB + cold start), preservando header/footer del layout.
// Espeja la estructura real: hero oscuro + destacados + destinos.
// Nota: al vivir a nivel del grupo, también cubre rutas hijas sin loading
// propio (checkout, mi-cuenta, etc.).
export default function Loading() {
  return (
    <div className="bg-white">
      {/* Hero — mismo wash oscuro, altura y offsets que HomeHero (que se
          desliza bajo el header con margen negativo) */}
      <section
        className="relative flex items-center bg-[#1a201a]
                   -mt-20 pt-[196px] md:pt-[230px] pb-24 md:pb-32
                   min-h-[680px] md:min-h-[860px]"
      >
        <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8">
          <div className="max-w-3xl mx-auto flex flex-col items-center">
            <div className="h-7 w-56 rounded-full bg-white/10 animate-pulse" />
            <div className="mt-5 md:mt-7 w-full flex flex-col items-center gap-3">
              <div className="h-10 md:h-[4.5rem] w-3/4 rounded-xl bg-white/10 animate-pulse" />
              <div className="h-10 md:h-[4.5rem] w-1/2 rounded-xl bg-white/10 animate-pulse" />
            </div>
            <div className="mt-4 md:mt-6 h-4 w-2/3 max-w-md rounded-full bg-white/10 animate-pulse" />
          </div>
          <div className="mt-6 md:mt-12 max-w-5xl mx-auto h-14 md:h-[72px] rounded-full bg-white/10 animate-pulse" />
        </div>
      </section>

      {/* Destacados — misma grilla que FeaturedListings */}
      <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
        <div className="mb-10 md:mb-12 space-y-3">
          <div className="h-3.5 w-24 bg-neutral-100 rounded-full animate-pulse" />
          <div className="h-9 w-72 bg-neutral-100 rounded-md animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-[4/3] bg-neutral-100 rounded-2xl animate-pulse" />
              <div className="space-y-1.5">
                <div className="h-3 w-2/3 bg-neutral-100 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-neutral-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Destinos — tres cards verticales como CordobaDestinations */}
      <section className="max-w-[1400px] mx-auto px-4 md:px-8 py-12 md:py-20">
        <div className="mb-10 md:mb-12 space-y-3">
          <div className="h-3.5 w-24 bg-neutral-100 rounded-full animate-pulse" />
          <div className="h-9 w-80 bg-neutral-100 rounded-md animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] bg-neutral-100 rounded-3xl animate-pulse" />
          ))}
        </div>
      </section>
    </div>
  );
}
