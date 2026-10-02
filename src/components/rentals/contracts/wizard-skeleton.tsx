/** Silueta del asistente (alta y edición): encabezado, pasos, paso actual y resumen a la derecha. */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export function WizardSkeleton() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 max-w-[1280px] mx-auto">
      <Bar className="h-4 w-24" />
      <div className="space-y-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-72 max-w-[80vw]" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="space-y-4">
          <Bar className="h-4 w-40" />
          <Bar className="h-1.5 w-full rounded-full" />
          <div className="flex gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Bar key={i} className="h-8 w-8 rounded-full md:w-24" />
            ))}
          </div>
          <div className="rounded-xl border bg-card p-4 sm:p-6 space-y-4">
            <Bar className="h-6 w-56" />
            <Bar className="h-4 w-80 max-w-full" />
            <Bar className="h-10 w-full rounded-md" />
            <div className="grid gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bar key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <Bar className="h-3 w-20" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Bar className="h-2.5 w-24" />
              <Bar className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
