/**
 * Silueta de Rendiciones: header, 4 KPIs, "Para rendir" (título + control de
 * corte + tarjetas por propietario) y la lista agrupada por mes.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y mx-auto max-w-[1400px] space-y-4 sm:space-y-5 md:space-y-6">
      <div className="space-y-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border bg-card p-3 sm:p-4">
            <Bar className="h-3 w-24" />
            <Bar className="h-6 w-32" />
            <Bar className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="flex items-end justify-between gap-3">
        <Bar className="h-4 w-28" />
        <Bar className="h-10 w-72 rounded-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted animate-pulse" />
                <div className="space-y-1.5">
                  <Bar className="h-4 w-32" />
                  <Bar className="h-3 w-24" />
                </div>
              </div>
              <Bar className="h-6 w-28" />
            </div>
            <Bar className="h-2.5 w-full rounded-full" />
            <Bar className="h-10 w-full" />
            <div className="flex justify-between border-t pt-3">
              <Bar className="h-3 w-24" />
              <Bar className="h-8 w-36" />
            </div>
          </div>
        ))}
      </div>
      <Bar className="h-4 w-28" />
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
            <div className="size-9 rounded-full bg-muted animate-pulse sm:size-10" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-4 w-40" />
              <Bar className="h-3 w-56" />
            </div>
            <Bar className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
