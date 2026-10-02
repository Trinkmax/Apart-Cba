/**
 * Silueta de la ficha de una propiedad: volver + título con chips, acciones,
 * columna principal (contrato, gastos, documentos) y lateral (dueños, mandato, servicios).
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

function CardBlock({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <div className={`rounded-xl border bg-card p-4 sm:p-5 space-y-3 ${className}`}>{children}</div>;
}

export default function Loading() {
  return (
    <div className="page-x page-y space-y-4 sm:space-y-5 md:space-y-6 max-w-5xl mx-auto">
      <div className="space-y-2">
        <Bar className="h-4 w-24" />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <Bar className="h-7 w-64" />
            <Bar className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Bar className="h-9 w-36 rounded-md" />
            <Bar className="h-9 w-24 rounded-md" />
            <Bar className="h-9 w-9 rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-6 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-start">
        <div className="lg:col-span-2 space-y-4 sm:space-y-5">
          <CardBlock>
            <Bar className="h-4 w-32" />
            <div className="flex justify-between gap-4">
              <Bar className="h-8 w-48" />
              <Bar className="h-8 w-36" />
            </div>
            <Bar className="h-2 w-full rounded-full" />
            <Bar className="h-8 w-32 rounded-md" />
          </CardBlock>
          <CardBlock className="h-48" />
          <CardBlock className="h-40" />
        </div>
        <div className="space-y-4 sm:space-y-5">
          <CardBlock>
            <Bar className="h-4 w-28" />
            <Bar className="h-10 w-full" />
            <Bar className="h-10 w-full" />
          </CardBlock>
          <CardBlock className="h-24" />
          <CardBlock className="h-36" />
        </div>
      </div>
    </div>
  );
}
