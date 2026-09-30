"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CurrencyCode } from "@/lib/marketplace/currency-config";

type Prefs = {
  currency: CurrencyCode;
  locale: string;
};

/**
 * La web cobra en pesos y habla en español: moneda e idioma son fijos (ARS +
 * es-AR). Antes salían de cookies y un selector con un tipo de cambio estático
 * que engañaba (el cobro es por transferencia en pesos). El provider y el hook
 * quedan por compatibilidad con los componentes que los leen.
 */
const FIXED_PREFS: Prefs = { currency: "ARS", locale: "es-AR" };

const MarketplacePrefsContext = createContext<Prefs>(FIXED_PREFS);

export function MarketplacePrefsProvider({ children }: { children: ReactNode }) {
  return <MarketplacePrefsContext.Provider value={FIXED_PREFS}>{children}</MarketplacePrefsContext.Provider>;
}

export function useMarketplacePrefs(): Prefs {
  return useContext(MarketplacePrefsContext);
}
