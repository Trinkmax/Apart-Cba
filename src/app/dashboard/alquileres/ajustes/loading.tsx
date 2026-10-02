/**
 * Esqueleto de Ajustes e índices, con la silueta de la página:
 *   1. encabezado;
 *   2. segmentado + tarjetas de ajuste agrupadas por mes;
 *   3. columna de índices (2 × 3 tarjetas) + calculadora.
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-52 rounded-md" />
          <Bar className="h-4 w-80 max-w-full" />
        </div>
        <Bar className="h-8 w-40 rounded-md" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="space-y-4">
          <Bar className="h-9 w-[330px] max-w-full rounded-lg" />
          {[3, 2].map((n, g) => (
            <div key={g} className="space-y-2.5">
              <Bar className="h-3.5 w-28" />
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <Bar className="size-12 shrink-0 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Bar className="h-4 w-1/2" />
                      <Bar className="h-3 w-2/3" />
                    </div>
                    <Bar className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="pl-[3.75rem] space-y-2">
                    <Bar className="h-6 w-56 max-w-full rounded-md" />
                    <Bar className="h-3 w-48" />
                    <div className="flex gap-2 pt-1">
                      <Bar className="h-8 w-24 rounded-md" />
                      <Bar className="h-8 w-32 rounded-md" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <Bar className="h-3 w-16" />
              <Bar className="h-8 w-32 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                  <Bar className="h-3.5 w-12" />
                  <Bar className="h-7 w-20 rounded-md" />
                  <Bar className="h-10 w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-4 py-3">
              <Bar className="h-4 w-44" />
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Bar className="h-10 w-full rounded-md" />
                <Bar className="h-10 w-full rounded-md" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Bar className="h-10 w-full rounded-md" />
                <Bar className="h-10 w-full rounded-md" />
              </div>
              <Bar className="h-8 w-full rounded-md" />
            </div>
            <div className="border-t p-4">
              <Bar className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
