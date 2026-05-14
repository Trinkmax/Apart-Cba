/**
 * Helpers de geografía para los selectores de país/provincia/ciudad del form de huésped.
 *
 * - Los nombres de países se traducen al español en el cliente con `Intl.DisplayNames`.
 *   Nunca persistimos el nombre traducido (sólo el ISO-3166-1 alpha-2).
 * - Las provincias y ciudades vienen del paquete `country-state-city` ya en idioma local
 *   y se persisten tal cual (state_code + city_name).
 */
import { Country, type ICountry } from "country-state-city";

export type CountryCode = string; // ISO-3166-1 alpha-2 (ej. "AR")
export type StateCode = string;   // código de estado/provincia según country-state-city (ej. "X")

// ---------------------------------------------------------------------------
// Nombres en español

let _displayNames: Intl.DisplayNames | null = null;
function getDisplayNames(): Intl.DisplayNames {
  if (!_displayNames) {
    _displayNames = new Intl.DisplayNames(["es"], { type: "region" });
  }
  return _displayNames;
}

export function getCountryNameES(code: CountryCode | null | undefined): string {
  if (!code) return "";
  try {
    return getDisplayNames().of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// ---------------------------------------------------------------------------
// Emoji bandera a partir del ISO code (regional indicator letters)

export function getCountryFlag(code: CountryCode | null | undefined): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6; // 🇦
  const upper = code.toUpperCase();
  const first = upper.charCodeAt(0) - 65;
  const second = upper.charCodeAt(1) - 65;
  if (first < 0 || first > 25 || second < 0 || second > 25) return "";
  return String.fromCodePoint(A + first) + String.fromCodePoint(A + second);
}

// ---------------------------------------------------------------------------
// Sort en español (acentos-insensible, idioma "es")

const _esCollator = new Intl.Collator("es", { sensitivity: "base", usage: "sort" });

export function sortByLocaleES<T>(arr: readonly T[], keyFn: (x: T) => string): T[] {
  return [...arr].sort((a, b) => _esCollator.compare(keyFn(a), keyFn(b)));
}

// ---------------------------------------------------------------------------
// Lista de países con nombre en español, ordenada alfabéticamente.
// Memoizamos para evitar recomputarla en cada render.

export interface CountryOption {
  /** ISO-3166-1 alpha-2 */
  code: CountryCode;
  /** Nombre traducido a español. */
  name: string;
  /** Emoji bandera. */
  flag: string;
}

let _allCountries: CountryOption[] | null = null;

export function getAllCountriesES(): CountryOption[] {
  if (_allCountries) return _allCountries;
  const raw: ICountry[] = Country.getAllCountries();
  const options: CountryOption[] = raw.map((c) => ({
    code: c.isoCode,
    name: getCountryNameES(c.isoCode) || c.name,
    flag: getCountryFlag(c.isoCode),
  }));
  _allCountries = sortByLocaleES(options, (o) => o.name);
  return _allCountries;
}
