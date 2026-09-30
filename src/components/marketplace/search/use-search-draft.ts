"use client";

import { useState } from "react";
import {
  MAX_GUESTS_FILTER,
  MAX_MONTHS,
  type SearchMode,
  type SearchState,
} from "@/lib/marketplace/catalog-filter";

/**
 * Lo que la persona está eligiendo en un buscador (hero o /buscar) antes de
 * apretar "Buscar". Se traduce a SearchState → URL con `searchHref`.
 */
export type SearchDraft = {
  mode: SearchMode;
  checkIn: string | null;
  /** Sólo en modo noche. */
  checkOut: string | null;
  /** Sólo en modo mes (1–12). */
  months: number;
  /** null = no lo dijo (no filtra). */
  guests: number | null;
};

export const EMPTY_DRAFT: SearchDraft = {
  mode: "noche",
  checkIn: null,
  checkOut: null,
  months: 1,
  guests: null,
};

export function draftFromState(s: SearchState): SearchDraft {
  return {
    mode: s.mode,
    checkIn: s.checkIn,
    checkOut: s.mode === "noche" ? s.checkOut : null,
    months: Math.min(MAX_MONTHS, Math.max(1, s.months ?? 1)),
    guests: s.guests ? Math.min(MAX_GUESTS_FILTER, Math.max(1, s.guests)) : null,
  };
}

/**
 * Aplica el borrador sobre el estado de búsqueda. Cambiar de pestaña borra el
 * precio máximo (noche y mes son escalas distintas).
 */
export function draftToState(d: SearchDraft, base: SearchState): SearchState {
  const modeChanged = d.mode !== base.mode;
  return {
    ...base,
    mode: d.mode,
    checkIn: d.checkIn,
    checkOut: d.mode === "noche" && d.checkIn && d.checkOut && d.checkOut > d.checkIn ? d.checkOut : null,
    months: d.mode === "mes" && d.checkIn ? d.months : null,
    guests: d.guests,
    priceMax: modeChanged ? null : base.priceMax,
    instant: d.mode === "noche" ? base.instant : false,
  };
}

export function useSearchDraft(initial: SearchDraft) {
  const [draft, setDraft] = useState<SearchDraft>(initial);

  function setMode(mode: SearchMode) {
    setDraft((d) => (d.mode === mode ? d : { ...d, mode, checkOut: mode === "mes" ? null : d.checkOut }));
  }
  function setDates(checkIn: string | null, checkOut: string | null) {
    setDraft((d) => ({ ...d, checkIn, checkOut }));
  }
  function setStart(checkIn: string | null) {
    setDraft((d) => ({ ...d, checkIn }));
  }
  function setMonths(months: number) {
    setDraft((d) => ({ ...d, months: Math.min(MAX_MONTHS, Math.max(1, months)) }));
  }
  function setGuests(guests: number | null) {
    setDraft((d) => ({ ...d, guests: guests == null ? null : Math.min(MAX_GUESTS_FILTER, Math.max(1, guests)) }));
  }

  return { draft, setDraft, setMode, setDates, setStart, setMonths, setGuests };
}
