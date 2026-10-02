/**
 * Silueta del detalle de una rendición: volver, título + acciones, aviso del
 * próximo paso y el documento (banda, grilla de datos, KPIs, renglones).
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y mx-auto max-w-5xl space-y-4 sm:space-y-5">
      <Bar className="h-4 w-28" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-8 w-24" />
          <Bar className="h-8 w-32" />
          <Bar className="h-8 w-24" />
        </div>
      </div>
      <Bar className="h-12 w-full rounded-lg" />
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="h-24 animate-pulse bg-muted" />
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5 bg-card px-4 py-3">
              <Bar className="h-2.5 w-16" />
              <Bar className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5 bg-card px-4 py-3.5">
              <Bar className="h-2.5 w-14" />
              <Bar className="h-5 w-24" />
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4 sm:p-6">
          <Bar className="h-4 w-48" />
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
