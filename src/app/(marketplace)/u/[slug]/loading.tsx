// Skeleton del detalle de alojamiento — espeja toolbar + galería + layout de
// dos columnas (info + widget de reserva) mientras el server arma la página.
export default function Loading() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-4 md:pt-8 bg-white">
      {/* Toolbar superior */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div className="h-5 w-20 rounded-full bg-neutral-100 animate-pulse" />
        <div className="hidden md:flex items-center gap-1">
          <div className="h-8 w-28 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="h-8 w-24 rounded-lg bg-neutral-100 animate-pulse" />
        </div>
      </div>

      {/* Galería — mismas alturas y grilla que UnitGallery */}
      <div className="grid grid-cols-1 md:grid-cols-4 grid-rows-1 md:grid-rows-2 gap-2 rounded-2xl overflow-hidden h-[280px] sm:h-[360px] md:h-[480px]">
        <div className="md:col-span-2 md:row-span-2 bg-neutral-100 animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="hidden md:block bg-neutral-100 animate-pulse" />
        ))}
      </div>

      {/* Dos columnas: info + widget de reserva */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 lg:gap-12 mt-8 md:mt-12 pb-12">
        <div className="space-y-10">
          {/* Título + meta */}
          <div className="space-y-3">
            <div className="h-8 w-3/4 rounded-md bg-neutral-100 animate-pulse" />
            <div className="h-4 w-1/2 rounded-full bg-neutral-100 animate-pulse" />
          </div>

          {/* Host + capacidad */}
          <div className="pb-8 border-b border-neutral-200 space-y-2.5">
            <div className="h-5 w-56 rounded-full bg-neutral-100 animate-pulse" />
            <div className="h-4 w-72 rounded-full bg-neutral-100 animate-pulse" />
          </div>

          {/* Descripción */}
          <div className="space-y-2.5">
            <div className="h-4 w-full rounded-full bg-neutral-100 animate-pulse" />
            <div className="h-4 w-full rounded-full bg-neutral-100 animate-pulse" />
            <div className="h-4 w-2/3 rounded-full bg-neutral-100 animate-pulse" />
          </div>

          {/* Comodidades */}
          <div className="pt-8 border-t border-neutral-200 space-y-4">
            <div className="h-6 w-48 rounded-md bg-neutral-100 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-5 w-3/4 rounded-full bg-neutral-100 animate-pulse" />
              ))}
            </div>
          </div>
        </div>

        {/* Widget de reserva */}
        <aside className="lg:sticky lg:top-28 self-start">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-lg p-6 space-y-4">
            <div className="flex items-baseline justify-between">
              <div className="h-7 w-32 rounded-md bg-neutral-100 animate-pulse" />
              <div className="h-4 w-16 rounded-full bg-neutral-100 animate-pulse" />
            </div>
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-neutral-200">
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-12 rounded-full bg-neutral-100 animate-pulse" />
                  <div className="h-4 w-20 rounded-full bg-neutral-100 animate-pulse" />
                </div>
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-12 rounded-full bg-neutral-100 animate-pulse" />
                  <div className="h-4 w-20 rounded-full bg-neutral-100 animate-pulse" />
                </div>
              </div>
              <div className="border-t border-neutral-200 p-3 space-y-2">
                <div className="h-2.5 w-16 rounded-full bg-neutral-100 animate-pulse" />
                <div className="h-4 w-24 rounded-full bg-neutral-100 animate-pulse" />
              </div>
            </div>
            <div className="h-12 w-full rounded-xl bg-neutral-100 animate-pulse" />
            <div className="h-3 w-48 mx-auto rounded-full bg-neutral-100 animate-pulse" />
          </div>
        </aside>
      </div>
    </div>
  );
}
