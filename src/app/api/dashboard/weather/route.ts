import { NextResponse } from "next/server";
import { DEFAULT_COORDS } from "@/lib/constants";

export const runtime = "nodejs";
// Re-fetch a Open-Meteo cada 30 min como mucho. Misma respuesta para todos
// los usuarios de la org (clima de Córdoba), así que cacheamos en HTTP layer.
export const revalidate = 1800;

type OpenMeteoResponse = {
  current?: { temperature_2m?: number; weather_code?: number };
  hourly?: { precipitation_probability?: number[]; weather_code?: number[] };
};

// WMO weather codes — https://open-meteo.com/en/docs
// 95/96/99 → tormenta. 80–82 → chubascos. 61–67 → lluvia. 71–77 → nieve.
function isThunderstormCode(code: number | undefined): boolean {
  return code === 95 || code === 96 || code === 99;
}

export async function GET() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(DEFAULT_COORDS.latitude));
  url.searchParams.set("longitude", String(DEFAULT_COORDS.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("hourly", "precipitation_probability,weather_code");
  url.searchParams.set("forecast_hours", "6");
  url.searchParams.set("timezone", DEFAULT_COORDS.timezone);

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false }, { status: 200 });
    }
    const data: OpenMeteoResponse = await res.json();

    const tempC = data.current?.temperature_2m;
    const probs = data.hourly?.precipitation_probability ?? [];
    const codes = data.hourly?.weather_code ?? [];
    const willRain6h = probs.slice(0, 6).some((p) => typeof p === "number" && p >= 60);
    const isThunderstorm =
      isThunderstormCode(data.current?.weather_code) ||
      codes.slice(0, 6).some(isThunderstormCode);

    if (typeof tempC !== "number") {
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        tempC,
        willRain6h,
        isThunderstorm,
      },
      {
        headers: {
          // Cache adicional en el browser/CDN — 30min stale, 2h SWR.
          "Cache-Control": "public, max-age=1800, stale-while-revalidate=7200",
        },
      },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
