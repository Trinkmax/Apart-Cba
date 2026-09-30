/**
 * Esqueleto de la ficha: encabezado, galería y las dos columnas (info + widget).
 * En celular (< md) con la forma de la ficha: la foto primero y a sangre, y el
 * título en una hoja que sube sobre ella (todo con max-md:; desde md, igual).
 */
export default function Loading() {
  const block = "rounded-2xl bg-cream-200 motion-safe:animate-pulse";
  return (
    <div
      className="mx-auto w-full max-w-[1280px] px-4 pb-12 max-md:flex max-md:flex-col max-md:pt-0 sm:px-6 md:pt-6 lg:px-8"
      aria-busy="true"
      aria-label="Cargando el lugar"
    >
      <div className={`h-6 w-36 max-md:hidden ${block}`} />
      <div className="mt-4 flex flex-col gap-5 max-md:relative max-md:z-10 max-md:-mt-6 max-md:rounded-t-[1.75rem] max-md:bg-cream max-md:pt-6 max-sm:-mx-4 max-sm:px-4 sm:max-md:-mx-6 sm:max-md:px-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <div className={`h-11 w-64 sm:w-80 ${block}`} />
          <div className={`h-5 w-72 max-w-full ${block}`} />
          {/* Celular: la fila de capacidad. Va ANTES de las pastillas: space-y (v4) le
              da margen de abajo a todo hijo que no sea el último, y las pastillas
              tienen que seguir siendo el último en md+. */}
          <div className="h-[5.75rem] rounded-3xl bg-cream-200 motion-safe:animate-pulse md:hidden" />
          <div className="flex gap-2 pt-1 max-md:hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 w-28 rounded-full bg-cream-200 motion-safe:animate-pulse" />
            ))}
          </div>
        </div>
        <div className="flex gap-2 max-md:hidden">
          <div className="h-11 w-32 rounded-full bg-cream-200 motion-safe:animate-pulse" />
          <div className="h-11 w-28 rounded-full bg-cream-200 motion-safe:animate-pulse" />
        </div>
      </div>

      <div className="-mx-4 h-[min(100vw,62svh)] bg-cream-200 max-md:order-first motion-safe:animate-pulse sm:-mx-6 sm:h-[min(75vw,62svh)] md:hidden" />
      <div className="mt-8 hidden h-[420px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl md:grid lg:h-[480px]">
        <div className="col-span-2 row-span-2 bg-cream-200 motion-safe:animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-cream-200 motion-safe:animate-pulse" />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 md:mt-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
        <div className="space-y-5">
          <div className={`h-7 w-48 ${block}`} />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`h-12 ${block}`} />
            ))}
          </div>
          <div className={`h-28 rounded-3xl ${block}`} />
          <div className={`h-40 ${block}`} />
        </div>
        <div className="hidden lg:block">
          <div className="h-[460px] rounded-3xl bg-paper shadow-apart-lg ring-1 ring-cream-300" />
        </div>
      </div>
    </div>
  );
}
