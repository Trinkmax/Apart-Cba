"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, ShieldCheck, CalendarX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  computePricing,
  countNights,
} from "@/lib/marketplace/pricing";
import { formatInCurrency } from "@/lib/marketplace/currency-config";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import type { MarketplaceListingDetail } from "@/lib/types/database";

type Props = {
  listing: MarketplaceListingDetail;
  blockedDates: string[];
  isAuthenticated: boolean;
  prefillCheckIn?: string | null;
  prefillCheckOut?: string | null;
  prefillGuests?: number | null;
};

export function UnitBookingWidget({
  listing,
  blockedDates,
  isAuthenticated,
  prefillCheckIn,
  prefillCheckOut,
  prefillGuests,
}: Props) {
  const router = useRouter();
  const { currency: targetCurrency, locale } = useMarketplacePrefs();
  const fmt = (amount: number) =>
    formatInCurrency(amount, listing.marketplace_currency, targetCurrency, locale);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [checkIn, setCheckIn] = useState<string>(prefillCheckIn ?? "");
  const [checkOut, setCheckOut] = useState<string>(prefillCheckOut ?? "");
  const [guests, setGuests] = useState(prefillGuests ?? 1);
  const [pending, startTransition] = useTransition();

  const blockedSet = useMemo(() => new Set(blockedDates), [blockedDates]);

  const hasOverlap = useMemo(() => {
    if (!checkIn || !checkOut || checkOut <= checkIn) return false;
    let cursor = checkIn;
    while (cursor < checkOut) {
      if (blockedSet.has(cursor)) return true;
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
    }
    return false;
  }, [checkIn, checkOut, blockedSet]);

  const nights = checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;
  const minNights = listing.min_nights;
  const maxNights = listing.max_nights;

  const breakdown = useMemo(() => {
    if (nights === 0) return null;
    return computePricing({
      checkInIso: checkIn,
      checkOutIso: checkOut,
      basePrice: listing.base_price,
      cleaningFee: listing.cleaning_fee,
      rules: listing.pricing_rules,
    });
  }, [nights, checkIn, checkOut, listing]);

  const showCleaning = (listing.cleaning_fee ?? 0) > 0;

  let validation: { ok: true } | { ok: false; reason: string } = { ok: true };
  if (!checkIn || !checkOut) {
    validation = { ok: false, reason: "Elegí fechas para ver la disponibilidad" };
  } else if (checkOut <= checkIn) {
    validation = { ok: false, reason: "El check-out debe ser posterior al check-in" };
  } else if (hasOverlap) {
    validation = { ok: false, reason: "Algunas de esas noches no están disponibles" };
  } else if (nights < minNights) {
    validation = { ok: false, reason: `Mínimo ${minNights} ${minNights === 1 ? "noche" : "noches"}` };
  } else if (maxNights && nights > maxNights) {
    validation = { ok: false, reason: `Máximo ${maxNights} noches` };
  } else if (listing.max_guests && guests > listing.max_guests) {
    validation = { ok: false, reason: `Hasta ${listing.max_guests} huéspedes` };
  }

  function handleReserve() {
    if (!validation.ok) {
      toast.error(validation.reason);
      return;
    }
    const params = new URLSearchParams({
      checkin: checkIn,
      checkout: checkOut,
      huespedes: String(guests),
    });
    if (!isAuthenticated) {
      const redirect = `/checkout/${listing.id}?${params.toString()}`;
      startTransition(() => {
        router.push(`/ingresar?redirect=${encodeURIComponent(redirect)}`);
      });
      return;
    }
    startTransition(() => {
      router.push(`/checkout/${listing.id}?${params.toString()}`);
    });
  }

  // Mostrar fechas bloqueadas como rojo en input min/max (HTML date input
  // no soporta blocklist nativamente; el server valida igual al final).
  void today;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-lg p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-2xl font-semibold">
            {fmt(listing.base_price)}
          </span>
          <span className="text-neutral-500"> /noche</span>
        </div>
        {listing.rating_count > 0 ? (
          <div className="flex items-center gap-1 text-sm">
            <Star size={13} className="fill-neutral-900 stroke-neutral-900" />
            <span className="font-medium">{listing.rating_avg.toFixed(2)}</span>
            <span className="text-neutral-500">· {listing.rating_count}</span>
          </div>
        ) : null}
      </div>

      <div className="border border-neutral-300 rounded-xl overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-neutral-300">
          <label className="block p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide">Llegada</div>
            <input
              type="date"
              value={checkIn}
              min={today}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full text-sm mt-1 focus:outline-none bg-transparent"
            />
          </label>
          <label className="block p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide">Salida</div>
            <input
              type="date"
              value={checkOut}
              min={checkIn || today}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full text-sm mt-1 focus:outline-none bg-transparent"
            />
          </label>
        </div>
        <div className="border-t border-neutral-300 p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide">Huéspedes</div>
            <div className="text-sm mt-1">
              {guests} {guests === 1 ? "huésped" : "huéspedes"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setGuests((g) => Math.max(1, g - 1))}
              className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-900 grid place-items-center"
              aria-label="Disminuir"
            >
              −
            </button>
            <span className="w-6 text-center text-sm">{guests}</span>
            <button
              onClick={() => setGuests((g) => Math.min(listing.max_guests ?? 20, g + 1))}
              className="h-7 w-7 rounded-full border border-neutral-300 hover:border-neutral-900 grid place-items-center"
              aria-label="Aumentar"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {hasOverlap ? (
        <div className="flex items-start gap-2 rounded-xl bg-sage-50 border border-sage-200 p-3 text-sm text-sage-800">
          <CalendarX size={16} className="mt-0.5 shrink-0" />
          <div>Algunas de estas fechas ya están reservadas. Probá otras.</div>
        </div>
      ) : null}

      <button
        onClick={handleReserve}
        disabled={pending || !validation.ok}
        className={cn(
          "w-full h-12 rounded-xl font-medium transition-all",
          validation.ok
            ? "bg-gradient-to-r from-sage-500 to-sage-600 text-white hover:from-sage-600 hover:to-sage-700 shadow-sm hover:shadow-md"
            : "bg-neutral-100 text-neutral-400 cursor-not-allowed"
        )}
      >
        {validation.ok
          ? listing.instant_book
            ? "Reservar al toque"
            : "Solicitar reservar"
          : validation.reason}
      </button>

      {validation.ok ? (
        <div className="text-xs text-neutral-500 text-center">
          {listing.instant_book
            ? "Confirmación inmediata. No se cobra al reservar."
            : "El anfitrión tiene 48hs para responder. No se cobra al solicitar."}
        </div>
      ) : null}

      {breakdown && validation.ok ? (
        <div className="space-y-2 pt-3 border-t border-neutral-200">
          <div className="flex justify-between text-sm">
            <span className="underline underline-offset-2 text-neutral-700">
              {fmt(breakdown.avg_price_per_night)} ×{" "}
              {nights} {nights === 1 ? "noche" : "noches"}
            </span>
            <span>{fmt(breakdown.subtotal)}</span>
          </div>
          {showCleaning ? (
            <div className="flex justify-between text-sm">
              <span className="underline underline-offset-2 text-neutral-700">
                Tarifa de limpieza
              </span>
              <span>{fmt(breakdown.cleaning_fee)}</span>
            </div>
          ) : null}
          <div className="pt-2 border-t border-neutral-200 flex justify-between font-semibold">
            <span>Total</span>
            <span>{fmt(breakdown.total)}</span>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-2 text-xs text-neutral-500">
        <ShieldCheck size={14} className="text-emerald-600" />
        Reserva protegida. Cancelación según política {listing.cancellation_policy}.
      </div>
    </div>
  );
}

// Hidden hook to refresh blockedDates if user navigates (not used right now)
void useEffect;
