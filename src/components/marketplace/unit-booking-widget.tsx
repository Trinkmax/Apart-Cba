"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, ShieldCheck, CalendarX, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addDaysIso,
  computePricing,
  countNights,
  todayIsoAR,
} from "@/lib/marketplace/pricing";
import {
  formatInCurrency,
  isConverted,
  CONVERSION_NOTICE,
} from "@/lib/marketplace/currency-config";
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

/** Date local (00:00) desde un ISO YYYY-MM-DD — sin saltos de timezone. */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** ISO YYYY-MM-DD desde un Date usando componentes locales (lo que ve el usuario). */
function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso: string): string {
  return isoToDate(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

const DESKTOP_MQ = "(min-width: 768px)";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP_MQ);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => false,
  );
}

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
  // "Hoy" en horario argentino: el mismo piso que aplica submitCheckout.
  const today = useMemo(() => todayIsoAR(), []);
  // Prefill de la URL: si viene vencido (deep link viejo, tab abierta días),
  // se descarta — si no, el botón habilitaría fechas que el server rechaza.
  const [checkIn, setCheckIn] = useState<string>(() =>
    prefillCheckIn && prefillCheckIn >= todayIsoAR() ? prefillCheckIn : ""
  );
  const [checkOut, setCheckOut] = useState<string>(() =>
    prefillCheckIn && prefillCheckIn >= todayIsoAR() && prefillCheckOut ? prefillCheckOut : ""
  );
  const [guests, setGuests] = useState(prefillGuests ?? 1);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isDesktop = useIsDesktop();

  const blockedSet = useMemo(() => new Set(blockedDates), [blockedDates]);

  // La ventana de datos de ocupación es de 12 meses (getListingBlockedDates):
  // el calendario navega hasta ahí y no más — más allá no sabríamos qué está
  // libre, y mostrarlo "disponible" sería mentir.
  const todayDate = useMemo(() => isoToDate(today), [today]);
  const maxDate = useMemo(() => {
    const d = isoToDate(today);
    d.setMonth(d.getMonth() + 12);
    return d;
  }, [today]);

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
  const isMensual = listing.default_mode === "mensual";

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

  const selectedRange: DateRange | undefined = checkIn
    ? { from: isoToDate(checkIn), to: checkOut ? isoToDate(checkOut) : undefined }
    : undefined;

  // Estamos eligiendo el checkout (ya hay llegada, falta salida).
  const selectingEnd = Boolean(checkIn && !checkOut);

  // Primera noche ocupada DESPUÉS de la llegada elegida. Esa fecha es válida
  // como checkout (el huésped sale a la mañana, el siguiente entra ese día:
  // rangos half-open [checkin, checkout), igual que bookings_no_overlap) pero
  // ninguna fecha posterior lo es — el rango saltaría un bloqueo.
  const nextBlockedAfterStart = useMemo(() => {
    if (!checkIn) return null;
    let min: string | null = null;
    for (const b of blockedSet) {
      if (b > checkIn && (min === null || b < min)) min = b;
    }
    return min;
  }, [checkIn, blockedSet]);

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) {
      setCheckIn("");
      setCheckOut("");
      return;
    }
    const fromIso = dateToIso(range.from);
    // Una noche ocupada nunca puede ser llegada (sí checkout — ver arriba).
    if (blockedSet.has(fromIso)) {
      setCheckIn("");
      setCheckOut("");
      return;
    }
    const toIso = range.to ? dateToIso(range.to) : "";
    setCheckIn(fromIso);
    // from === to es el primer click del rango: todavía no hay checkout.
    // Si el rango cruza una noche ocupada (p.ej. click hacia atrás que
    // invierte el rango por encima de un bloqueo), se reinicia desde el from.
    const complete = Boolean(toIso && toIso !== fromIso);
    if (complete && rangeHasBlockedNight(fromIso, toIso)) {
      setCheckOut("");
      return;
    }
    setCheckOut(complete ? toIso : "");
    if (complete) {
      setCalOpen(false);
    }
  }

  function rangeHasBlockedNight(fromIso: string, toIso: string): boolean {
    let cursor = fromIso;
    let safety = 0;
    while (cursor < toIso && safety < 366 * 2) {
      if (blockedSet.has(cursor)) return true;
      cursor = addDaysIso(cursor, 1);
      safety++;
    }
    return false;
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

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-lg p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-2xl font-semibold">
            {fmt(listing.base_price)}
          </span>
          <span className="text-neutral-500"> /noche</span>
          {isMensual ? (
            <div className="text-sm text-neutral-500 mt-0.5">
              ≈ {fmt(listing.base_price * 30)} /mes
            </div>
          ) : null}
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
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full grid grid-cols-2 divide-x divide-neutral-300 text-left hover:bg-neutral-50 transition-colors"
              aria-label="Elegir fechas"
            >
              <span className="block p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wide">Llegada</span>
                <span className={cn("block text-sm mt-1", checkIn ? "text-neutral-900" : "text-neutral-400")}>
                  {checkIn ? formatDayLabel(checkIn) : "Agregar fecha"}
                </span>
              </span>
              <span className="block p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wide">Salida</span>
                <span className={cn("block text-sm mt-1", checkOut ? "text-neutral-900" : "text-neutral-400")}>
                  {checkOut ? formatDayLabel(checkOut) : "Agregar fecha"}
                </span>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align={isDesktop ? "end" : "center"}
            sideOffset={8}
            className="w-auto max-w-[calc(100vw-1.5rem)] p-0 max-h-[80vh] overflow-y-auto"
          >
            <Calendar
              mode="range"
              locale={es}
              numberOfMonths={isDesktop ? 2 : 1}
              selected={selectedRange}
              onSelect={handleSelect}
              defaultMonth={selectedRange?.from ?? todayDate}
              startMonth={todayDate}
              endMonth={maxDate}
              // Ocupado = noches de bookings pendiente/confirmada/check_in +
              // solicitudes pendientes vigentes (mismo criterio que el
              // constraint bookings_no_overlap).
              // Eligiendo la SALIDA, la primera noche ocupada después de la
              // llegada sí es clickeable (checkout de recambio) pero nada más
              // allá: un rango nunca puede saltar por encima de un bloqueo.
              disabled={[
                { before: todayDate },
                { after: maxDate },
                (date: Date) => {
                  const d = dateToIso(date);
                  if (d === checkOut) return false;
                  if (selectingEnd) {
                    if (d <= checkIn) return blockedSet.has(d);
                    if (nextBlockedAfterStart) return d > nextBlockedAfterStart;
                    return false;
                  }
                  return blockedSet.has(d);
                },
              ]}
              modifiers={{
                blocked: (date: Date) => {
                  const d = dateToIso(date);
                  // El checkout elegido / la fecha de recambio elegible no se
                  // muestran tachados: para el huésped son días válidos.
                  if (d === checkOut) return false;
                  if (selectingEnd && d === nextBlockedAfterStart) return false;
                  return blockedSet.has(d);
                },
              }}
              modifiersClassNames={{
                blocked: "[&>button]:line-through [&>button]:text-neutral-300",
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-neutral-200 px-4 py-2.5 text-xs text-neutral-500">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="line-through text-neutral-400">15</span>
                  No disponible
                </span>
                {minNights > 1 ? <span>Mínimo {minNights} noches</span> : null}
                {nights > 0 ? (
                  <span className="font-medium text-neutral-700">
                    {nights} {nights === 1 ? "noche" : "noches"}
                  </span>
                ) : null}
              </div>
              {checkIn || checkOut ? (
                <button
                  type="button"
                  onClick={() => {
                    setCheckIn("");
                    setCheckOut("");
                  }}
                  className="underline underline-offset-2 hover:text-neutral-900"
                >
                  Limpiar fechas
                </button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
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

      {!checkIn && !checkOut ? (
        <button
          type="button"
          onClick={() => setCalOpen(true)}
          className="w-full inline-flex items-center justify-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          <CalendarDays size={15} />
          Ver disponibilidad en el calendario
        </button>
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
          {isConverted(listing.marketplace_currency, targetCurrency) ? (
            <p className="pt-1 text-xs text-neutral-500">
              {CONVERSION_NOTICE.replace("{currency}", listing.marketplace_currency)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-2 text-xs text-neutral-500">
        <ShieldCheck size={14} className="text-emerald-600" />
        Reserva protegida. Cancelación según política {listing.cancellation_policy}.
      </div>
    </div>
  );
}
