/**
 * Skeleton de la vista de liquidaciones. Se muestra al instante mientras el
 * server component resuelve los datos (navegación inicial y cold starts), en
 * vez de dejar la pantalla trabada. Alternar tabs NO pasa por acá (es cliente).
 */
export default function Loading() {
  return (
    <div className="page-x page-y max-w-6xl mx-auto">
      <div className="space-y-4 sm:space-y-5 md:space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <div className="h-7 w-44 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-56 rounded bg-muted animate-pulse" />
          </div>
          <div className="h-9 w-40 rounded-md bg-muted animate-pulse" />
        </div>

        <div className="h-11 w-[292px] max-w-full rounded-lg bg-muted animate-pulse" />

        <div className="space-y-3">
          <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
          <div className="rounded-xl border divide-y overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
                <div className="size-9 sm:size-10 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-4 w-40 max-w-[60%] rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 max-w-[35%] rounded bg-muted animate-pulse" />
                </div>
                <div className="h-6 w-20 rounded bg-muted animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
