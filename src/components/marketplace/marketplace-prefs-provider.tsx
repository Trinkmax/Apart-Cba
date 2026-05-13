"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CurrencyCode } from "@/lib/marketplace/currency-config";

type Prefs = {
  currency: CurrencyCode;
  locale: string;
};

const MarketplacePrefsContext = createContext<Prefs>({
  currency: "ARS",
  locale: "es-AR",
});

export function MarketplacePrefsProvider({
  currency,
  locale,
  children,
}: Prefs & { children: ReactNode }) {
  // Plain value object — no useMemo needed since props are primitives so React
  // doesn't re-render consumers unless they actually change.
  return (
    <MarketplacePrefsContext.Provider value={{ currency, locale }}>
      {children}
    </MarketplacePrefsContext.Provider>
  );
}

export function useMarketplacePrefs(): Prefs {
  return useContext(MarketplacePrefsContext);
}
