/** Silueta de la ficha de una persona: volver, tarjeta de perfil, contratos + documentos y la columna de datos. */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-5xl mx-auto">
      <Bar className="h-4 w-40" />
      <div className="rounded-xl border bg-card p-4 sm:p-6 flex flex-col sm:flex-row gap-4">
        <div className="size-14 sm:size-16 rounded-2xl bg-muted animate-pulse shrink-0" />
        <div className="flex-1 space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-40" />
          <div className="flex gap-2">
            <Bar className="h-9 w-28 rounded-lg" />
            <Bar className="h-9 w-36 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-24 rounded-md" />
          <Bar className="h-9 w-9 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
        <div className="lg:col-span-2 space-y-4 sm:space-y-5">
          <div className="rounded-xl border bg-card h-44 animate-pulse" />
          <div className="rounded-xl border bg-card h-40 animate-pulse" />
        </div>
        <div className="space-y-4 sm:space-y-5">
          <div className="rounded-xl border bg-card h-52 animate-pulse" />
          <div className="rounded-xl border bg-card h-36 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
