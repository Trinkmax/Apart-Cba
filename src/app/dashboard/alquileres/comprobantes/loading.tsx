/**
 * Silueta de Comprobantes: encabezado con ← mes →, 4 tarjetas, las bandejas y
 * la vista partida (lista a la izquierda, visor a la derecha en escritorio).
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Bar className="h-7 w-48" />
          <Bar className="h-4 w-72 max-w-full" />
        </div>
        <Bar className="h-11 w-52 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-16" />
            <Bar className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="flex gap-4 border-b pb-2">
        <Bar className="h-5 w-24" />
        <Bar className="h-5 w-28" />
        <Bar className="h-5 w-28" />
        <Bar className="h-5 w-20" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="rounded-xl border bg-card divide-y overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-3 sm:p-4">
              <Bar className="size-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Bar className="h-4 w-3/5" />
                <Bar className="h-3 w-4/5" />
                <Bar className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden lg:block rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Bar className="size-11 rounded-xl" />
            <div className="space-y-2">
              <Bar className="h-5 w-56" />
              <Bar className="h-4 w-72" />
            </div>
          </div>
          <Bar className="h-[60vh] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
