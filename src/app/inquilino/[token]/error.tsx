"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { ForceLightBody } from "@/components/rentals/portal/force-light-body";

/** Falla de la base o de la red al armar el portal: mensaje amable y reintentar. */
export default function TenantPortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="light flex min-h-dvh items-center justify-center bg-[#f4f5f7] px-4 py-10 text-foreground">
      <ForceLightBody />
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <WifiOff size={22} />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">No pudimos cargar tu cuenta</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Puede ser la conexión o algo de nuestro lado. Probá de nuevo en unos segundos.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          <RefreshCw size={16} /> Reintentar
        </button>
      </div>
    </div>
  );
}
