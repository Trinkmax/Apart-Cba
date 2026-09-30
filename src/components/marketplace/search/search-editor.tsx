"use client";

import { Search } from "lucide-react";
import { ApartButton } from "@/components/marketplace/brand/apart-button";
import {
  SearchRangeCalendar,
  SearchSingleCalendar,
  rangeNights,
} from "@/components/marketplace/search-range-calendar";
import {
  addMonthsIso,
  monthsLabel,
  nightsLabel,
  rangeLabel,
  shortDateLabel,
} from "@/lib/marketplace/catalog-filter";
import { isMonthlyStay } from "@/lib/marketplace/stay";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import { GuestsStepper, MonthsStepper } from "./search-fields";
import type { SearchDraft } from "./use-search-draft";

/** Cuántos meses se apilan en la hoja mobile (hoy + 12). */
const STACKED_MONTHS = 13;

export type SearchEditorHandlers = {
  setMode: (mode: SearchDraft["mode"]) => void;
  setDates: (checkIn: string | null, checkOut: string | null) => void;
  setStart: (checkIn: string | null) => void;
  setMonths: (months: number) => void;
  setGuests: (guests: number | null) => void;
};

/** Línea de estado del editor: "3 noches · 3–6 oct", "Elegí la salida", etc. */
export function draftStatus(d: SearchDraft): { text: string; monthlyHint: boolean } {
  if (d.mode === "mes") {
    if (!d.checkIn) return { text: "Elegí desde cuándo", monthlyHint: false };
    const end = addMonthsIso(d.checkIn, d.months);
    return { text: `${monthsLabel(d.months)} · ${rangeLabel(d.checkIn, end)}`, monthlyHint: false };
  }
  const nights = rangeNights(d.checkIn, d.checkOut);
  if (nights > 0 && d.checkIn && d.checkOut) {
    return {
      text: `${nightsLabel(nights)} · ${rangeLabel(d.checkIn, d.checkOut)}`,
      monthlyHint: isMonthlyStay(nights),
    };
  }
  if (d.checkIn) return { text: `Llegada ${shortDateLabel(d.checkIn, { weekday: true })} · elegí la salida`, monthlyHint: false };
  return { text: "Elegí la llegada y la salida", monthlyHint: false };
}

function MonthlyHint() {
  return (
    <p className="text-[0.8125rem] leading-snug text-ink-600">
      Para 28 noches o más te mostramos estadías por mes: se consultan.
    </p>
  );
}

const clearClass =
  "rounded-full px-1 text-sm font-semibold text-forest-700 underline decoration-forest-700/30 underline-offset-4 outline-none " +
  "hover:decoration-forest-700 focus-visible:ring-[3px] focus-visible:ring-forest-500/40 disabled:no-underline disabled:opacity-40";

/**
 * El buscador completo "abierto" (sin popovers anidados): pestaña, calendario
 * visible y contadores. Lo usa la píldora de /buscar dentro de un Popover
 * (desktop) o de una hoja a pantalla completa (mobile).
 */
export function SearchEditorBody({
  draft,
  handlers,
  layout,
  onSubmit,
}: {
  draft: SearchDraft;
  handlers: SearchEditorHandlers;
  layout: "desktop" | "mobile";
  /** Sólo desktop: el pie con "Buscar" va adentro del cuerpo. */
  onSubmit?: () => void;
}) {
  const stacked = layout === "mobile";
  const status = draftStatus(draft);

  function onRange(ci: string | null, co: string | null) {
    handlers.setDates(ci, co);
  }

  const steppers = (
    <div className={cn("grid gap-4", stacked ? "" : "sm:grid-cols-2 sm:gap-8")}>
      <GuestsStepper value={draft.guests} onChange={handlers.setGuests} />
      {draft.mode === "mes" ? <MonthsStepper value={draft.months} onChange={handlers.setMonths} /> : null}
    </div>
  );

  const calendar =
    draft.mode === "noche" ? (
      <SearchRangeCalendar
        checkIn={draft.checkIn}
        checkOut={draft.checkOut}
        onChange={onRange}
        months={stacked ? STACKED_MONTHS : 2}
        stacked={stacked}
        className={stacked ? "mx-auto" : undefined}
      />
    ) : (
      <SearchSingleCalendar
        value={draft.checkIn}
        onChange={handlers.setStart}
        months={stacked ? STACKED_MONTHS : 2}
        stacked={stacked}
        className={stacked ? "mx-auto" : undefined}
      />
    );

  if (stacked) {
    return (
      <div className="flex flex-col gap-5">
        <ModeToggle value={draft.mode} onChange={handlers.setMode} labels={{ noche: "Por noches", mes: "Por meses" }} className="self-start" />
        <div className="rounded-3xl bg-paper p-4 ring-1 ring-cream-300">{steppers}</div>
        <div>
          <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-forest-600">
            {draft.mode === "mes" ? "Desde" : "Llegada y salida"}
          </p>
          {calendar}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[40rem] max-w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ModeToggle size="sm" value={draft.mode} onChange={handlers.setMode} />
        <p aria-live="polite" className="text-[0.9375rem] font-bold text-forest-700">
          {status.text}
        </p>
      </div>
      {calendar}
      <div className="mt-5 border-t border-cream-300 pt-4">{steppers}</div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-cream-300 pt-4">
        <div className="min-w-0">
          {status.monthlyHint ? (
            <MonthlyHint />
          ) : (
            <button
              type="button"
              className={clearClass}
              disabled={!draft.checkIn}
              onClick={() => handlers.setDates(null, null)}
            >
              Borrar fechas
            </button>
          )}
        </div>
        <ApartButton type="button" variant="cta" size="lg" onClick={onSubmit}>
          <Search aria-hidden className="size-5" strokeWidth={2.5} />
          Buscar
        </ApartButton>
      </div>
    </div>
  );
}

/** Pie fijo de la hoja mobile: estado ("3 noches · 3–6 oct") + "Buscar". */
export function SearchEditorFooter({
  draft,
  onClear,
  onSubmit,
}: {
  draft: SearchDraft;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const status = draftStatus(draft);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p aria-live="polite" className="truncate text-[0.9375rem] font-bold text-forest-700">
          {status.text}
        </p>
        {status.monthlyHint ? (
          <MonthlyHint />
        ) : (
          <button type="button" className={clearClass} disabled={!draft.checkIn} onClick={onClear}>
            Borrar fechas
          </button>
        )}
      </div>
      <ApartButton type="button" variant="cta" size="lg" onClick={onSubmit}>
        <Search aria-hidden className="size-5" strokeWidth={2.5} />
        Buscar
      </ApartButton>
    </div>
  );
}
