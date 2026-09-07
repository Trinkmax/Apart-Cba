/**
 * Skeleton de Resultados. Aparece al instante mientras el server component
 * calcula el mes (navegación inicial, cambio de mes y cold starts), con la
 * misma silueta que la página: header + tira de KPIs + dos tablas + detalle.
 */
export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-72 max-w-full rounded bg-muted animate-pulse" />
        </div>
        <div className="h-9 w-[220px] rounded-lg bg-muted animate-pulse" />
      </div>

      <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-muted animate-pulse" />
              <div className="h-7 w-32 max-w-full rounded bg-muted animate-pulse" />
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-3 w-full rounded-full bg-muted animate-pulse" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 md:gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
            <div className="rounded-xl border divide-y overflow-hidden">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 p-3">
                  <div className="h-4 w-32 max-w-[40%] rounded bg-muted animate-pulse" />
                  <div className="flex-1" />
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-20 rounded bg-muted animate-pulse hidden sm:block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="h-4 w-36 rounded bg-muted animate-pulse" />
        <div className="rounded-xl border divide-y overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <div className="h-4 w-28 rounded bg-muted animate-pulse" />
              <div className="h-4 w-20 rounded bg-muted animate-pulse" />
              <div className="flex-1" />
              <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
