"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDayLabel } from "@/lib/marketplace/dates";
import { formatCurrency } from "@/lib/marketplace/pricing";
import { headlinePrice } from "@/lib/marketplace/stay";
import { effectiveMinNights, MAX_CONSULT_MONTHS, monthsLabel, nightsLabel, type StayView } from "@/lib/marketplace/widget-quote";
import { useListingStay } from "./stay-context";

/** Precio titular del widget según la pestaña ("$ 70.000 / noche", "Precio a consultar"). */
export function PriceHeadline({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { listing, view, checkIn, checkOut } = useListingStay();
  const hp = headlinePrice(listing, view);
  // Mismo mínimo que el pie del calendario y que el checkout (ver effectiveMinNights).
  const min = effectiveMinNights(listing, checkIn || null, checkOut || null);
  return (
    <div className={cn("min-w-0", className)}>
      {hp.kind === "amount" ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span
            className={cn(
              "font-extrabold tracking-[-0.02em] text-forest-700 tabular-nums",
              compact ? "text-lg" : "text-[1.75rem] leading-none",
            )}
          >
            {formatCurrency(hp.amount, listing.marketplace_currency)}
          </span>
          <span className={cn("text-ink-500", compact ? "text-[0.8125rem]" : "text-[0.9375rem]")}>/ {hp.per}</span>
        </p>
      ) : (
        <p className={cn("font-extrabold text-forest-700", compact ? "text-base" : "text-[1.375rem] leading-tight")}>
          Precio a consultar
        </p>
      )}
      {!compact && view === "noche" && min > 1 ? (
        <p className="mt-1.5 text-[0.8125rem] text-ink-500">Estadía mínima: {nightsLabel(min)}</p>
      ) : null}
      {!compact && view === "mes" ? (
        <p className="mt-1.5 text-[0.8125rem] text-ink-500">Estadías de 28 noches o más, por mes.</p>
      ) : null}
    </div>
  );
}

const VIEW_LABELS: Record<StayView, string> = { noche: "Por noches", mes: "Por mes" };

/** "Por noches | Por mes" (sólo si la unidad ofrece las dos). */
export function ViewToggle({ className }: { className?: string }) {
  const { views, view, setView } = useListingStay();
  if (views.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Tipo de estadía"
      className={cn("grid grid-cols-2 gap-1 rounded-full bg-cream-200 p-1 ring-1 ring-inset ring-cream-300", className)}
    >
      {views.map((v) => {
        const active = v === view;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setView(v)}
            className={cn(
              "min-h-11 rounded-full px-3 text-sm font-bold transition-[background-color,color,box-shadow] duration-200",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40",
              active ? "bg-paper text-forest-700 shadow-apart-sm" : "text-ink-500 hover:text-forest-700",
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}

/** Cuántos meses (vista por mes). */
export function MonthsStepper({ className }: { className?: string }) {
  const { months, setMonths } = useListingStay();
  const btn =
    "flex size-11 items-center justify-center rounded-full border border-forest-700/25 bg-paper text-forest-700 transition-colors hover:border-forest-700/50 hover:bg-leaf-100 disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-500/40";
  return (
    <div className={cn("flex items-center justify-between gap-3", className)} role="group" aria-label="Cuántos meses">
      <div>
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">Cuántos meses</p>
        <p className="mt-0.5 text-[0.9375rem] font-semibold text-ink-900" aria-live="polite">
          {monthsLabel(months)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => setMonths(months - 1)} disabled={months <= 1} aria-label="Un mes menos">
          <Minus className="size-4" aria-hidden />
        </button>
        <span className="w-6 text-center text-base font-bold tabular-nums text-forest-700" aria-hidden>
          {months}
        </span>
        <button
          type="button"
          className={btn}
          onClick={() => setMonths(months + 1)}
          disabled={months >= MAX_CONSULT_MONTHS}
          aria-label="Un mes más"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Las dos celdas de fecha ("Llegada | Salida" o "Desde | Hasta"). Presentacional. */
export function DateCells({ className }: { className?: string }) {
  const { view, checkIn, checkOut } = useListingStay();
  const mes = view === "mes";
  const cell = (label: string, iso: string, placeholder: string) => (
    <span className="block min-w-0 px-4 py-2.5 text-left">
      <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">{label}</span>
      {/* ink-500 en el "Elegir" vacío: ink-400 sobre papel daba 3,5:1. */}
      <span className={cn("mt-0.5 block truncate text-[0.9375rem] font-semibold", iso ? "text-ink-900" : "text-ink-500")}>
        {iso ? formatDayLabel(iso) : placeholder}
      </span>
    </span>
  );
  return (
    <span className={cn("grid grid-cols-2 divide-x divide-cream-300", className)}>
      {cell(mes ? "Desde" : "Llegada", checkIn, "Elegir")}
      {cell(mes ? "Hasta" : "Salida", checkOut, mes ? "—" : "Elegir")}
    </span>
  );
}
