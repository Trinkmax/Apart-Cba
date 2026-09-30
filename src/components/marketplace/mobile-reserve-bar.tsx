"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import { BookingPanel } from "@/components/marketplace/listing/booking-panel";
import { PriceHeadline } from "@/components/marketplace/listing/booking-panel-parts";
import { useListingStay } from "@/components/marketplace/listing/stay-context";
import { formatDayLabel } from "@/lib/marketplace/dates";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { monthsLabel, nightsLabel } from "@/lib/marketplace/widget-quote";

/**
 * Barra fija inferior de la ficha en mobile: precio (o el total, si ya hay
 * fechas) y un botón que abre la hoja con el calendario, los huéspedes, la
 * cotización y el botón para pedir. Comparte el estado con el widget de
 * escritorio (ListingStayProvider).
 */
export function MobileReserveBar() {
  const { evaluation, listing, view, checkIn, checkOut, months, dateRequest } = useListingStay();
  const [open, setOpen] = useState(false);

  // La barra es fija: el body reserva su alto (sólo < lg) para que no tape el
  // final de la página ni el footer.
  useEffect(() => {
    const cls = "max-lg:pb-[calc(5.5rem+env(safe-area-inset-bottom))]";
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, []);

  // "Elegí otras fechas" desde el aviso ?error= (en mobile abre la hoja).
  const [seenRequest, setSeenRequest] = useState(dateRequest.n);
  if (dateRequest.n !== seenRequest) {
    setSeenRequest(dateRequest.n);
    if (dateRequest.target === "mobile") setOpen(true);
  }

  const currency = listing.marketplace_currency;
  let summary: React.ReactNode;
  if (evaluation.kind === "nightly") {
    summary = (
      <>
        <p className="text-lg font-extrabold leading-tight tracking-[-0.02em] text-forest-700 tabular-nums">
          {formatCurrency(evaluation.total, currency)} <span className="text-[0.8125rem] font-medium text-ink-500">total</span>
        </p>
        <p className="truncate text-[0.8125rem] text-ink-700">
          {nightsLabel(evaluation.nights)} · {formatDayLabel(checkIn)} al {formatDayLabel(checkOut)}
        </p>
      </>
    );
  } else {
    const line =
      view === "mes" && checkIn
        ? `Desde ${formatDayLabel(checkIn)} · ${monthsLabel(months)}`
        : evaluation.kind === "invalid"
          ? "Revisá tus fechas"
          : evaluation.kind === "monthly"
            ? "Estadías por mes: se consultan"
            : "Elegí tus fechas";
    summary = (
      <>
        <PriceHeadline compact />
        <p className="truncate text-[0.8125rem] text-ink-700">{line}</p>
      </>
    );
  }

  const ctaLabel =
    evaluation.kind === "nightly"
      ? evaluation.cta.label
      : evaluation.kind === "monthly" || evaluation.cta.kind === "consult"
        ? "Consultar"
        : evaluation.kind === "invalid"
          ? "Cambiar fechas"
          : "Elegir fechas";

  return (
    <>
      {/* Entra deslizándose desde abajo (fija: no mueve nada de la página). */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-300 bg-paper/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-apart-lg backdrop-blur-md motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden"
        aria-hidden={open ? true : undefined}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div className="min-w-0" aria-live="polite">
            {summary}
          </div>
          <ApartButton type="button" variant="cta" size="lg" className="shrink-0 px-5" onClick={() => setOpen(true)}>
            {ctaLabel}
          </ApartButton>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl border-cream-300 bg-cream p-0 font-apart text-ink-900"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cream-300 bg-cream/95 px-5 py-3 backdrop-blur-md">
            <div className="min-w-0">
              <SheetTitle className="truncate font-apart text-base font-extrabold text-forest-700">
                {listing.display_title}
              </SheetTitle>
              <SheetDescription className="text-[0.8125rem] text-ink-500">
                {view === "mes" ? "Estadía por mes" : "Elegí tus fechas y huéspedes"}
              </SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-forest-700 hover:bg-forest-700/[0.06] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <BookingPanel variant="sheet" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
