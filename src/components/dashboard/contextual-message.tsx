"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudRain, Sparkles, Sun, CloudLightning } from "lucide-react";
import {
  getDaypart,
  pickContextualMessage,
  type ContextualMessage as Msg,
  type WeatherSnapshot,
} from "@/lib/contextual-messages";
import { cn } from "@/lib/utils";

type WeatherResponse =
  | { ok: true; tempC: number; willRain6h: boolean; isThunderstorm: boolean }
  | { ok: false };

/**
 * Línea contextual debajo del saludo. Hidrata después del primer paint
 * para no bloquear el TTFB del dashboard. Si el clima falla, simplemente
 * elige una frase sin clima — nunca mostramos error.
 */
export function ContextualMessage({
  firstName,
  userId,
}: {
  firstName: string;
  userId: string;
}) {
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    let cancelled = false;

    const compute = (weather: WeatherSnapshot | null) => {
      const now = new Date();
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Cordoba",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const weekdayShort = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Argentina/Cordoba",
        weekday: "short",
      }).format(now);
      const weekdayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekday = weekdayMap.indexOf(weekdayShort);

      const result = pickContextualMessage({
        firstName,
        daypart: getDaypart(now).key,
        weekday: weekday >= 0 ? weekday : now.getDay(),
        weather,
        seed: `${userId}-${dateKey}`,
      });
      if (!cancelled) setMsg(result);
    };

    // Hidratamos primero con frase sin clima — UX inmediata.
    compute(null);

    // Después intentamos enriquecer con clima (no bloquea).
    fetch("/api/dashboard/weather", { cache: "force-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<WeatherResponse>) : null))
      .then((data) => {
        if (!data || data.ok !== true) return;
        compute({
          tempC: data.tempC,
          willRain6h: data.willRain6h,
          isThunderstorm: data.isThunderstorm,
        });
      })
      .catch(() => {
        // Clima falló: ya tenemos una frase sin clima. No-op.
      });

    return () => {
      cancelled = true;
    };
  }, [firstName, userId]);

  // Reservamos el alto exacto para evitar layout shift cuando hidrata.
  if (!msg) return <div className="h-5" aria-hidden />;

  const iconClassName = cn(
    "shrink-0",
    msg.tone === "weather" && "text-sky-500",
    msg.tone === "time" && "text-amber-500",
    msg.tone === "weekday" && "text-violet-500",
    msg.tone === "neutral" && "text-muted-foreground",
  );

  return (
    <p
      className={cn(
        "text-sm text-muted-foreground flex items-center gap-1.5",
        "animate-in fade-in duration-300",
      )}
    >
      {renderIcon(msg, iconClassName)}
      <span>{msg.text}</span>
    </p>
  );
}

function renderIcon(msg: Msg, className: string) {
  const size = 14;
  if (msg.tone === "weather") {
    if (/tormenta/i.test(msg.text)) return <CloudLightning size={size} className={className} />;
    if (/lluvi|paraguas/i.test(msg.text)) return <CloudRain size={size} className={className} />;
    if (/calor/i.test(msg.text)) return <Sun size={size} className={className} />;
    return <Cloud size={size} className={className} />;
  }
  if (msg.tone === "time") return <Cloud size={size} className={className} />;
  return <Sparkles size={size} className={className} />;
}
