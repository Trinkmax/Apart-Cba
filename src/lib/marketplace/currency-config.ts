/**
 * Currency configuration & FX conversion for the marketplace surface.
 *
 * We support a fixed set of presentation currencies. Listings have their own
 * `marketplace_currency` (set by the host); we convert that source amount to
 * the user's selected currency for display only — payment still settles in
 * the host's currency at checkout (handled separately).
 *
 * Rates are static for now (no API call on every render). They can be
 * refreshed by editing this file or, later, swapped for a server-side fetcher
 * with `unstable_cache` + revalidate.
 */

export const SUPPORTED_CURRENCIES = ["ARS", "USD", "EUR"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = "ARS";

/**
 * `rates[from][to]` = how many units of `to` you get for 1 unit of `from`.
 * Calibrated mid-May 2026 (approximate; not for payment decisions).
 */
const RATES: Record<CurrencyCode, Record<CurrencyCode, number>> = {
  ARS: { ARS: 1,       USD: 0.00091, EUR: 0.00083 },
  USD: { ARS: 1100,    USD: 1,       EUR: 0.92    },
  EUR: { ARS: 1205,    USD: 1.087,   EUR: 1       },
};

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Convert `amount` from source currency to target. Safe for unknown inputs. */
export function convertCurrency(amount: number, from: string, to: CurrencyCode): number {
  const src = from.toUpperCase();
  if (!isSupportedCurrency(src)) return amount;
  if (src === to) return amount;
  const rate = RATES[src][to];
  return amount * rate;
}

/** Convert + format in user locale. Integer rounding for clean prices. */
export function formatInCurrency(
  amount: number,
  sourceCurrency: string,
  targetCurrency: CurrencyCode,
  locale: string = "es-AR",
): string {
  const converted = convertCurrency(amount, sourceCurrency, targetCurrency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: targetCurrency,
      maximumFractionDigits: 0,
    }).format(converted);
  } catch {
    return `${targetCurrency} ${Math.round(converted).toLocaleString(locale)}`;
  }
}
