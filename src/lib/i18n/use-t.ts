"use client";

import { useCallback } from "react";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import { t, type TKey } from "./dict";

/**
 * Client-side translation hook. Reads the active locale from the marketplace
 * preferences context so a single React re-render (triggered by router.refresh
 * after the cookie write) flips every translated string.
 */
export function useT() {
  const { locale } = useMarketplacePrefs();
  return useCallback(
    (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars),
    [locale],
  );
}
