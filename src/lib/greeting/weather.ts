import { unstable_cache } from "next/cache";
import { DEFAULT_COORDS } from "@/lib/constants";
import type { WeatherNow } from "./lines";
import { summarizeWeather, type OpenMeteo } from "./weather-summary";

/*
 * El clima de Córdoba para la frase del saludo (Open-Meteo, sin clave).
 *
 * Se guarda 30 minutos para todos (`unstable_cache`): el Resumen lo pide en
 * cada render y en cada refresco en vivo, y Open-Meteo no tiene por qué
 * enterarse. Sólo viajan las coordenadas de la ciudad: nada de la persona ni de
 * la organización. Si falla, la frase sale sin clima: nunca un error.
 */

async function fetchWeather(latitude: number, longitude: number, timezone: string): Promise<WeatherNow> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_gusts_10m");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
  url.searchParams.set("forecast_hours", "12");
  url.searchParams.set("daily", "temperature_2m_max");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", timezone);

  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const weather = summarizeWeather((await res.json()) as OpenMeteo);
  // Lanzar (no devolver null) para que un tropiezo no quede guardado 30 minutos.
  if (!weather) throw new Error("open-meteo: respuesta sin temperatura");
  return weather;
}

const cachedWeather = unstable_cache(fetchWeather, ["greeting-weather-v1"], { revalidate: 1800 });

export async function getWeatherNow(): Promise<WeatherNow | null> {
  try {
    return await cachedWeather(DEFAULT_COORDS.latitude, DEFAULT_COORDS.longitude, DEFAULT_COORDS.timezone);
  } catch {
    return null;
  }
}
