/**
 * Esqueleto del resumen de Alquileres, con la misma silueta que la página:
 *   1. saludo + botones;
 *   2. cuatro KPIs (el primero, con barra apilada);
 *   3. agenda "Para hacer hoy" (6 filas) y columna lateral (ajustes,
 *      vencimientos, índices).
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Bar className="h-7 w-56 rounded-md" />
            <Bar className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Bar className="h-9 w-32 rounded-md" />
            <Bar className="h-9 w-36 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <div className="col-span-2 lg:col-span-1 rounded-xl border bg-card p-4 sm:p-5 space-y-2.5">
            <Bar className="h-3 w-28" />
            <Bar className="h-8 w-40 rounded-md" />
            <Bar className="h-3 w-32" />
            <Bar className="h-2.5 w-full rounded-full" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-4 sm:p-5 space-y-2.5">
              <Bar className="h-3 w-24" />
              <Bar className="h-7 w-28 rounded-md" />
              <Bar className="h-3 w-32 max-w-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <Bar className="h-4 w-32" />
            <Bar className="h-3 w-40" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Bar className="size-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-3.5 w-2/3" />
                  <Bar className="h-3 w-full max-w-md" />
                </div>
                <Bar className="hidden sm:block h-8 w-28 rounded-md" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1].map((p) => (
            <div key={p} className="rounded-xl border bg-card overflow-hidden">
              <div className="border-b px-4 py-3">
                <Bar className="h-3 w-28" />
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Bar className="size-12 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Bar className="h-3.5 w-3/4" />
                    <Bar className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                <Bar className="h-3.5 w-12" />
                <Bar className="h-7 w-20 rounded-md" />
                <Bar className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
