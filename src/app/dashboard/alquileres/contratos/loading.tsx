/**
 * Silueta de /dashboard/alquileres/contratos: header + 4 KPIs + segmentado +
 * buscador y filas (mismo wrapper que la página para que no salte).
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
          <Bar className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-44 rounded-md" />
          <Bar className="h-9 w-36 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-32" />
            <Bar className="h-3 w-28" />
          </div>
        ))}
      </div>
      <Bar className="h-9 w-[22rem] max-w-full rounded-lg" />
      <div className="flex gap-2">
        <Bar className="h-9 w-72 rounded-md" />
        <Bar className="h-8 w-28 rounded-full" />
        <Bar className="h-8 w-32 rounded-full" />
      </div>
      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-3.5 sm:px-4">
            <Bar className="size-12 rounded-lg md:hidden" />
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-52 max-w-full" />
              <Bar className="h-3 w-36" />
            </div>
            <Bar className="hidden md:block h-4 w-28" />
            <Bar className="hidden md:block h-4 w-24" />
            <Bar className="hidden md:block h-4 w-32" />
            <Bar className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
