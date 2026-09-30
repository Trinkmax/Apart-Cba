"use client";

import { AlertCircle, X } from "lucide-react";
import { useListingStay } from "./stay-context";

/**
 * Aviso que manda el checkout con `?error=` cuando algo cambió entre la
 * elección y el pedido (p. ej. otro huésped pidió esas fechas). Sólo se
 * muestran textos conocidos (listingErrorMessage): el parámetro viene por URL.
 */
export function ListingErrorBanner() {
  const { urlError, dismissUrlError, requestDates } = useListingStay();
  if (!urlError) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-2xl bg-[#fdecea] px-4 py-3.5 text-[#b42318] ring-1 ring-inset ring-[#b42318]/15"
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold leading-snug">{urlError}</p>
        <button
          type="button"
          onClick={requestDates}
          className="mt-1.5 min-h-11 rounded-full text-sm font-bold underline decoration-[#b42318]/40 underline-offset-4 hover:decoration-[#b42318] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b42318]/30"
        >
          Elegir otras fechas
        </button>
      </div>
      <button
        type="button"
        onClick={dismissUrlError}
        aria-label="Cerrar aviso"
        className="-mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[#b42318]/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b42318]/30"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
