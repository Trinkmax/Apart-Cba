/** Silueta de /alquileres/personas: encabezado, 4 KPIs, buscador + chips y la lista. */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-32 rounded-md" />
          <Bar className="h-9 w-36 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-20" />
            <Bar className="h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-9 w-full sm:w-72 rounded-md" />
        {[0, 1, 2].map((i) => (
          <Bar key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="rounded-xl border bg-card divide-y overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
            <div className="size-9 sm:size-10 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-4 w-44" />
              <Bar className="h-3 w-64 max-w-full" />
              <Bar className="h-5 w-52 rounded-full" />
            </div>
            <Bar className="h-5 w-20 hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
