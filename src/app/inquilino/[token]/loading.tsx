/** Silueta del portal (una columna, celular primero). */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="light min-h-dvh bg-[#f4f5f7] text-foreground">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <Bar className="size-9 rounded-xl" />
          <div className="space-y-1.5">
            <Bar className="h-4 w-36" />
            <Bar className="h-3 w-24" />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-xl space-y-4 px-4 pt-5">
        <div className="space-y-2 px-1">
          <Bar className="h-7 w-40" />
          <Bar className="h-4 w-56" />
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5">
          <Bar className="h-3 w-28" />
          <Bar className="h-10 w-48" />
          <Bar className="h-4 w-40" />
          <Bar className="mt-2 h-12 w-full rounded-xl" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-2xl border bg-card p-5">
            <Bar className="h-3 w-32" />
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
