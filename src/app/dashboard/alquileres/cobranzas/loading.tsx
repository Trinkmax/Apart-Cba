/**
 * Silueta de Cobranzas: encabezado con el selector de mes, 4 KPIs, la barra
 * de cobrado / por cobrar / vencido, el buscador y la lista agrupada.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto" aria-busy="true" aria-label="Cargando cobranzas">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-44" />
          <Bar className="h-4 w-64" />
        </div>
        <Bar className="h-10 w-48 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-7 w-32" />
            <Bar className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
        <Bar className="h-3 w-full rounded-full" />
        <Bar className="h-3 w-72" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Bar className="h-9 w-full sm:w-72 rounded-md" />
        <Bar className="hidden sm:block h-3 w-24" />
      </div>
      {[4, 3].map((n, g) => (
        <div key={g} className="space-y-2">
          <Bar className="h-5 w-40" />
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <Bar className="size-12 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-40" />
                  <Bar className="h-3 w-56" />
                </div>
                <Bar className="h-8 w-24" />
                <Bar className="hidden sm:block h-8 w-20 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
