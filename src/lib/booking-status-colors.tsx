"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { BOOKING_STATUS_META } from "@/lib/constants";
import type {
  BookingStatus,
  BookingStatusColors,
} from "@/lib/types/database";

type EffectiveColors = Record<BookingStatus, string>;

const BookingStatusColorsContext = createContext<EffectiveColors | null>(null);

/**
 * Inyecta el mapa de colores efectivos (override de la org + defaults) al árbol.
 * Renderizar en `dashboard/layout.tsx` (o donde haga falta) con la config de la
 * org actual. Cuando una clave no está en `override`, cae al default del
 * `BOOKING_STATUS_META`.
 */
export function BookingStatusColorsProvider({
  override,
  children,
}: {
  override: BookingStatusColors | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo<EffectiveColors>(() => {
    const out = {} as EffectiveColors;
    (Object.keys(BOOKING_STATUS_META) as BookingStatus[]).forEach((s) => {
      const ov = override?.[s];
      out[s] = (ov && ov.trim()) || BOOKING_STATUS_META[s].color;
    });
    return out;
  }, [override]);
  return (
    <BookingStatusColorsContext.Provider value={value}>
      {children}
    </BookingStatusColorsContext.Provider>
  );
}

/** Devuelve el mapa completo. */
export function useBookingStatusColors(): EffectiveColors {
  const ctx = useContext(BookingStatusColorsContext);
  if (ctx) return ctx;
  // Fallback si se usa fuera del provider (ej. en tests o pantallas
  // standalone): devolver los defaults del constant.
  const out = {} as EffectiveColors;
  (Object.keys(BOOKING_STATUS_META) as BookingStatus[]).forEach((s) => {
    out[s] = BOOKING_STATUS_META[s].color;
  });
  return out;
}

/** Atajo para un solo status. */
export function useBookingStatusColor(status: BookingStatus): string {
  return useBookingStatusColors()[status];
}
