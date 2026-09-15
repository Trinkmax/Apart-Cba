/**
 * Skeleton de Resultados. Aparece al instante mientras el server component
 * calcula el mes (navegación inicial, cambio de mes/modo y cold starts), con la
 * misma silueta que la página:
 *   1. encabezado con el segmentado y el mes;
 *   2. tarjeta (número grande, barra fina, barra apilada, 5 KPIs);
 *   3. franja de cierre;
 *   4. panel "Para revisar" plegado (3 líneas);
 *   5. selector + tabla de 8 filas;
 *   6. pestañas + tabla de 12 filas.
 */
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      {/* 1 · Encabezado */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-40 rounded-md" />
          <Bar className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Bar className="h-9 w-[232px] rounded-lg" />
          <Bar className="h-9 w-[220px] rounded-lg" />
        </div>
      </div>

      <div className="space-y-2.5">
        {/* 2 · Tarjeta */}
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="grid gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-end">
            <div className="space-y-2.5">
              <Bar className="h-3 w-28" />
              <Bar className="h-8 w-56 max-w-full rounded-md" />
              <Bar className="h-3 w-72 max-w-full" />
            </div>
            <div className="space-y-2">
              <Bar className="h-3 w-32" />
              <Bar className="h-2 w-full rounded-full" />
              <Bar className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <div className="mt-5 space-y-4 border-t pt-4">
            <Bar className="h-3 w-36" />
            <Bar className="h-3 w-full rounded-full" />
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 sm:gap-y-4 md:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 sm:block sm:space-y-2">
                  <Bar className="h-3 w-24" />
                  <Bar className="h-6 w-32 max-w-full" />
                </div>
              ))}
            </div>
            <Bar className="h-20 w-full rounded-lg" />
          </div>
        </div>

        {/* 3 · Franja de cierre */}
        <div className="rounded-lg border border-dashed px-3 py-2.5">
          <Bar className="h-3 w-full max-w-3xl" />
        </div>
      </div>

      {/* 4 · Para revisar */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b px-4 py-3">
          <Bar className="h-4 w-28" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <Bar className="h-4 w-56 max-w-[50%]" />
              <div className="flex-1" />
              <Bar className="h-3 w-24 hidden sm:block" />
              <Bar className="h-7 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* 5 · Selector + tabla */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Bar className="h-4 w-32" />
          <Bar className="h-9 w-[280px] max-w-full rounded-lg" />
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="h-8 bg-muted/60 border-b" />
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Bar className="h-4 w-28 max-w-[30%]" />
                <div className="flex-1" />
                <Bar className="h-4 w-20" />
                <Bar className="h-4 w-20 hidden sm:block" />
                <Bar className="h-4 w-20 hidden md:block" />
                <Bar className="h-4 w-20 hidden lg:block" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6 · Pestañas + detalle */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bar className="h-8 w-32 rounded-md" />
          <Bar className="h-8 w-52 rounded-md" />
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="h-8 bg-muted/60 border-b" />
          <div className="divide-y">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Bar className="h-4 w-36 max-w-[35%]" />
                <div className="flex-1" />
                <Bar className="h-4 w-20" />
                <Bar className="h-4 w-20 hidden sm:block" />
                <Bar className="h-4 w-24 hidden md:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
