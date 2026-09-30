"use client";

import { useCallback } from "react";
import { useMarketplacePrefs } from "@/components/marketplace/marketplace-prefs-provider";
import { t, type TKey } from "./dict";

/**
 * Traductor del cliente. La web es es-AR fija (el provider de preferencias ya
 * no lee cookies); el hook queda por compatibilidad con los componentes que lo
 * usan.
 */
export function useT() {
  const { locale } = useMarketplacePrefs();
  return useCallback(
    (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars),
    [locale],
  );
}
