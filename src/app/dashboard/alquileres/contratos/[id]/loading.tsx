/**
 * Silueta de la ficha del contrato: volver, encabezado con acciones, línea de
 * tiempo, 6 tarjetas, pestañas y contenido (mismo wrapper que la página).
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-5xl mx-auto">
      <Bar className="h-4 w-24" />
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <Bar className="size-12 rounded-xl" />
          <div className="space-y-2">
            <Bar className="h-7 w-44" />
            <Bar className="h-4 w-72 max-w-[70vw]" />
          </div>
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-36 rounded-md" />
          <Bar className="h-9 w-40 rounded-md" />
          <Bar className="h-9 w-20 rounded-md" />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
        <Bar className="h-4 w-32" />
        <Bar className="h-3 w-full max-w-sm" />
        <div className="flex gap-1 pt-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Bar key={i} className="h-[4.5rem] flex-1 rounded-lg" />
          ))}
        </div>
        <Bar className="h-3 w-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-4 space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-6 w-32" />
            <Bar className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="flex gap-4 border-b pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-5 w-20" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-xl border bg-card h-96 animate-pulse" />
        <div className="space-y-3">
          <div className="rounded-xl border bg-card h-28 animate-pulse" />
          <div className="rounded-xl border bg-card h-28 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
