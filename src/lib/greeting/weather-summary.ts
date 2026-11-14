import type { WeatherNow } from "./lines";

/* Lo puro del clima del saludo: de la respuesta de Open-Meteo a `WeatherNow`. */

const STORM_CODES = new Set([95, 96, 99]);
// Llovizna 51–57, lluvia 61–67, chaparrones 80–82.
const isRainCode = (code: number | undefined) =>
  code !== undefined && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82));

export interface OpenMeteo {
  current?: { temperature_2m?: number; weather_code?: number; wind_gusts_10m?: number };
  hourly?: { temperature_2m?: number[]; precipitation_probability?: number[]; weather_code?: number[] };
  daily?: { temperature_2m_max?: number[] };
}

/** Pura: de la respuesta de Open-Meteo a lo que usa la frase (null si no sirve). */
export function summarizeWeather(data: OpenMeteo): WeatherNow | null {
  const tempC = data.current?.temperature_2m;
  if (typeof tempC !== "number" || !Number.isFinite(tempC)) return null;
  const code = data.current?.weather_code;
  const next6Codes = (data.hourly?.weather_code ?? []).slice(0, 6);
  const next6Rain = (data.hourly?.precipitation_probability ?? []).slice(0, 6);
  const next12Temps = (data.hourly?.temperature_2m ?? []).slice(0, 12).filter((t) => typeof t === "number");
  const maxC = data.daily?.temperature_2m_max?.[0];
  const gust = data.current?.wind_gusts_10m;
  return {
    tempC,
    maxC: typeof maxC === "number" ? maxC : null,
    lowNext12C: next12Temps.length > 0 ? Math.min(...next12Temps) : null,
    rainingNow: isRainCode(code),
    rainSoon: next6Rain.some((p) => typeof p === "number" && p >= 60),
    storm: (code !== undefined && STORM_CODES.has(code)) || next6Codes.some((c) => STORM_CODES.has(c)),
    gustKmh: typeof gust === "number" ? gust : null,
    code: typeof code === "number" ? code : null,
  };
}
