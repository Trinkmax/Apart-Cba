/**
 * Silueta de /alquileres/propiedades: encabezado con dos botones, 4 KPIs,
 * buscador + chips y la grilla de tarjetas. Mismo contenedor que la página.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-40" />
          <Bar className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-44 rounded-md" />
          <Bar className="h-9 w-40 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-7 w-16" />
            <Bar className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-9 w-full sm:w-64 rounded-md" />
        {[0, 1, 2].map((i) => (
          <Bar key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex justify-between">
              <Bar className="h-5 w-28" />
              <Bar className="h-5 w-20 rounded-full" />
            </div>
            <Bar className="h-5 w-3/4" />
            <Bar className="h-3 w-1/2" />
            <Bar className="h-[4.25rem] w-full rounded-lg" />
            <Bar className="h-6 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
