"use client";

import { CalendarDays } from "lucide-react";
import { formatInCurrency } from "@/lib/marketplace/currency-config";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import type { MarketplaceListingDetail } from "@/lib/types/database";

/**
 * Barra fija inferior sólo-mobile de la página de unidad. En celular el widget
 * de reserva queda al final del scroll; esta barra mantiene precio + CTA
 * siempre visibles y baja al calendario del widget.
 */
export function MobileReserveBar({ listing }: { listing: MarketplaceListingDetail }) {
  const { currency: targetCurrency, locale } = useMarketplacePrefs();
  const isMensual = listing.default_mode === "mensual";
  const price = formatInCurrency(
    isMensual ? listing.base_price * 30 : listing.base_price,
    listing.marketplace_currency,
    targetCurrency,
    locale
  );

  function scrollToWidget() {
    document
      .getElementById("booking-widget")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur-md
                 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]
                 flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <div className="font-semibold text-neutral-900 truncate">
          {isMensual ? "≈ " : ""}
          {price}
          <span className="text-sm font-normal text-neutral-500">
            {" "}
            {isMensual ? "/mes" : "/noche"}
          </span>
        </div>
        {listing.rating_count > 0 ? (
          <div className="text-xs text-neutral-500">
            ★ {listing.rating_avg.toFixed(2)} · {listing.rating_count} reseñas
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={scrollToWidget}
        className="shrink-0 inline-flex items-center gap-2 h-11 px-5 rounded-xl
                   bg-gradient-to-r from-sage-500 to-sage-600 text-white text-sm font-semibold
                   shadow-sm active:scale-[0.98] transition-transform"
      >
        <CalendarDays size={15} />
        Ver disponibilidad
      </button>
    </div>
  );
}
