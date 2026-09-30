"use server";

import { type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/marketplace/currency-config";

/**
 * Preferencias de la web pública. La web es ARS + es-AR: ya no hay selector de
 * moneda ni de idioma (el tipo de cambio estático engañaba y el cobro es por
 * transferencia en pesos). Estas funciones quedan por compatibilidad y NO leen
 * cookies: así las páginas que las usan pueden seguir siendo estáticas.
 */

type LocaleCode = "es-AR";
const DEFAULT_LOCALE: LocaleCode = "es-AR";

/** Moneda de la web: siempre ARS. */
export async function getActiveCurrency(): Promise<CurrencyCode> {
  return DEFAULT_CURRENCY;
}

/** Idioma de la web: siempre es-AR. */
export async function getActiveLocale(): Promise<LocaleCode> {
  return DEFAULT_LOCALE;
}

/** Sin efecto: la moneda es fija. */
export async function setMarketplaceCurrency(
  currency: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return currency === DEFAULT_CURRENCY
    ? { ok: true }
    : { ok: false, error: "La web muestra los precios en pesos argentinos." };
}

/** Sin efecto: el idioma es fijo. */
export async function setMarketplaceLocale(
  locale: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return locale === DEFAULT_LOCALE ? { ok: true } : { ok: false, error: "La web está en español." };
}
