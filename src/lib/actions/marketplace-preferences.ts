"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  type CurrencyCode,
  DEFAULT_CURRENCY,
  isSupportedCurrency,
} from "@/lib/marketplace/currency-config";

const CURRENCY_COOKIE = "rentos_currency";
const LOCALE_COOKIE = "rentos_locale";

const SUPPORTED_LOCALES = ["es-AR", "en-US", "pt-BR"] as const;
type LocaleCode = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: LocaleCode = "es-AR";

function isSupportedLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const COOKIE_OPTIONS = {
  maxAge: 365 * 24 * 60 * 60,
  path: "/",
  sameSite: "lax",
  httpOnly: false,
} as const;

/** Reads the active currency from the cookie. Falls back to ARS. */
export async function getActiveCurrency(): Promise<CurrencyCode> {
  const value = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return isSupportedCurrency(value) ? value : DEFAULT_CURRENCY;
}

/** Reads the active locale from the cookie. Falls back to es-AR. */
export async function getActiveLocale(): Promise<LocaleCode> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export async function setMarketplaceCurrency(currency: string) {
  if (!isSupportedCurrency(currency)) return { ok: false as const, error: "Moneda no soportada" };
  (await cookies()).set(CURRENCY_COOKIE, currency, COOKIE_OPTIONS);
  // Revalidate every marketplace route so server components re-fetch using
  // the new active currency.
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setMarketplaceLocale(locale: string) {
  if (!isSupportedLocale(locale)) return { ok: false as const, error: "Idioma no soportado" };
  (await cookies()).set(LOCALE_COOKIE, locale, COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
