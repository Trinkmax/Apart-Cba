/**
 * Carga genérica de la web: un esqueleto neutro en crema (sin hero oscuro).
 * Vive a nivel del grupo, así que cubre cualquier ruta hija sin loading propio;
 * las rutas pesadas (home, /buscar, ficha, reserva) tienen el suyo.
 * El header y el footer del layout quedan visibles.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:pt-12"
    >
      <span className="sr-only">Cargando…</span>
      <div aria-hidden className="motion-safe:animate-pulse">
        <div className="h-3 w-32 rounded-full bg-cream-300/70" />
        <div className="mt-4 h-9 w-3/4 max-w-xl rounded-2xl bg-cream-300/70 sm:h-11" />
        <div className="mt-3 h-5 w-1/2 max-w-sm rounded-full bg-cream-200" />

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-[4/3] rounded-3xl bg-cream-200" />
              <div className="h-4 w-2/3 rounded-full bg-cream-300/70" />
              <div className="h-3.5 w-1/2 rounded-full bg-cream-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
