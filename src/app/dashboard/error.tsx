"use client";

// Error boundary del dashboard. Antes no había ninguno, así que cualquier throw al
// renderizar un Server Component (o al re-renderizar tras un revalidatePath) caía en
// la pantalla genérica fea de Next ("An error occurred in the Server Components
// render…"). Esto lo reemplaza por una UI clara con botón de reintento.

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard:error-boundary]", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] grid place-items-center px-4">
      <div className="max-w-md w-full text-center rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="size-12 rounded-2xl bg-destructive/10 text-destructive grid place-items-center mx-auto mb-4">
          <AlertTriangle size={22} />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Algo salió mal</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          No pudimos cargar esta sección. Probá de nuevo; si sigue fallando,
          recargá la página.
        </p>
        {error.digest ? (
          <p className="mt-3 text-[11px] text-muted-foreground/70 font-mono">
            ref: {error.digest}
          </p>
        ) : null}
        <Button onClick={reset} className="mt-5">
          <RotateCw size={14} />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
