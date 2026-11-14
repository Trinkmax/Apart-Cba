import { Suspense } from "react";
import {
  CalendarDays,
  CloudLightning,
  CloudRain,
  CloudSun,
  Coffee,
  Flag,
  Flower2,
  Gift,
  Heart,
  Lightbulb,
  Moon,
  PartyPopper,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  ThermometerSun,
  TreePine,
  Umbrella,
  UtensilsCrossed,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { TexAvatar } from "@/components/tex/tex-avatar";
import { pickGreetingLine, type GreetingContext, type GreetingLine, type LineIcon, type LineTone } from "@/lib/greeting/lines";
import { getWeatherNow } from "@/lib/greeting/weather";
import { cn } from "@/lib/utils";

const ICONS: Record<Exclude<LineIcon, "tex">, LucideIcon> = {
  storm: CloudLightning,
  rain: CloudRain,
  umbrella: Umbrella,
  heat: ThermometerSun,
  cold: Snowflake,
  wind: Wind,
  sun: Sun,
  "cloud-sun": CloudSun,
  moon: Moon,
  sunrise: Sunrise,
  coffee: Coffee,
  lunch: UtensilsCrossed,
  calendar: CalendarDays,
  party: PartyPopper,
  gift: Gift,
  tree: TreePine,
  heart: Heart,
  flower: Flower2,
  flag: Flag,
  star: Star,
  bulb: Lightbulb,
  sparkles: Sparkles,
};

const TONES: Record<LineTone, string> = {
  sky: "text-sky-600 dark:text-sky-400",
  amber: "text-amber-600 dark:text-amber-400",
  orange: "text-orange-600 dark:text-orange-400",
  indigo: "text-indigo-500 dark:text-indigo-300",
  rose: "text-rose-500 dark:text-rose-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  brand: "text-primary",
  muted: "text-muted-foreground/80",
};

/**
 * La frase de debajo del saludo. Sale enseguida sin clima y, cuando llega el
 * clima (guardado 30 min, casi siempre al instante), con él: el pronóstico
 * nunca demora la pantalla.
 */
export function GreetingLineSlot({
  context,
  seed,
  className,
}: {
  context: Omit<GreetingContext, "weather">;
  /** Quién mira (su id): cada persona tiene su frase del día. */
  seed: string;
  className?: string;
}) {
  const withoutWeather = pickGreetingLine({ ...context, weather: null }, seed);
  return (
    <Suspense fallback={<GreetingLineView line={withoutWeather} className={className} />}>
      <WithWeather context={context} seed={seed} className={className} />
    </Suspense>
  );
}

async function WithWeather({
  context,
  seed,
  className,
}: {
  context: Omit<GreetingContext, "weather">;
  seed: string;
  className?: string;
}) {
  const weather = await getWeatherNow();
  return <GreetingLineView line={pickGreetingLine({ ...context, weather }, seed)} className={className} />;
}

export function GreetingLineView({ line, className }: { line: GreetingLine; className?: string }) {
  const Icon = line.icon === "tex" ? null : ICONS[line.icon];
  return (
    <p
      className={cn("flex items-start gap-2 text-[14px] leading-snug text-muted-foreground sm:text-[15px]", className)}
      data-greeting-group={line.group}
    >
      {Icon ? (
        <Icon className={cn("mt-[3px] size-4 shrink-0", TONES[line.tone])} aria-hidden />
      ) : (
        <TexAvatar mood="face" className="-my-0.5 size-6 shrink-0" />
      )}
      <span className="min-w-0 text-pretty">{line.text}</span>
    </p>
  );
}
