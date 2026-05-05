export type DaypartKey = "madrugada" | "manana" | "tarde" | "noche";

export type Daypart = {
  key: DaypartKey;
  greeting: string;
};

export function getDaypart(date: Date = new Date()): Daypart {
  // Hora local Argentina/Córdoba (offset fijo -03:00, sin DST).
  const hour = Number(
    new Intl.DateTimeFormat("es-AR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Argentina/Cordoba",
    }).format(date),
  );

  if (hour >= 5 && hour < 12) return { key: "manana", greeting: "Buenos días" };
  if (hour >= 12 && hour < 20) return { key: "tarde", greeting: "Buenas tardes" };
  if (hour >= 20 || hour < 5) return { key: "noche", greeting: "Buenas noches" };
  return { key: "madrugada", greeting: "Hola" };
}

/**
 * Toma el primer token alfabético de full_name. Si no hay nada usable,
 * devuelve fallback.
 */
export function getFirstName(fullName: string | null | undefined, fallback: string): string {
  if (!fullName) return fallback;
  const first = fullName.trim().split(/\s+/)[0];
  if (!first) return fallback;
  // Capitalizar por las dudas que venga en mayúsculas (e.g. "IGNACIO").
  return first.charAt(0).toLocaleUpperCase("es-AR") + first.slice(1).toLocaleLowerCase("es-AR");
}

// ─── Pool de frases contextuales ─────────────────────────────────────────────

export type WeatherSnapshot = {
  tempC: number;
  willRain6h: boolean;
  isThunderstorm: boolean;
};

export type ContextualInput = {
  firstName: string;
  daypart: DaypartKey;
  weekday: number; // 0=domingo … 6=sábado
  weather: WeatherSnapshot | null;
  /** Seed determinístico (userId + fechaISO) para fijar la frase del día. */
  seed: string;
};

/**
 * Hash determinístico simple (djb2). Estable entre renders del mismo día.
 */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(h);
}

const NEUTRAL_POOL = [
  "Espero que tengas un día tranquilo",
  "Que rinda el día",
  "Un día a la vez",
  "Hagamos que valga la pena",
  "Vamos con todo",
];

const MOTIVATIONAL_POOL = [
  (n: string) => `Vos podés, ${n}`,
  (n: string) => `Confío en vos, ${n}`,
  (n: string) => `${n}, hoy es un buen día para destrabar cosas`,
  () => "Paso a paso, sin apuro pero sin pausa",
];

export type ContextualMessage = {
  text: string;
  /** Tono/icono opcional para el cliente. */
  tone: "weather" | "time" | "weekday" | "neutral";
};

export function pickContextualMessage(input: ContextualInput): ContextualMessage | null {
  const { firstName, daypart, weekday, weather, seed } = input;
  const seedNum = hash(seed);

  // ─── P1: Clima fuerte ──────────────────────────────────────────────────────
  if (weather) {
    if (weather.isThunderstorm) {
      return { text: "Hay tormenta en el pronóstico — ojo con los huéspedes que llegan", tone: "weather" };
    }
    if (weather.willRain6h) {
      return { text: "Dicen que llueve hoy. Llevá paraguas si salís", tone: "weather" };
    }
    if (weather.tempC <= 8) {
      return { text: `Hace bastante frío (${Math.round(weather.tempC)}°). No olvides el abrigo`, tone: "weather" };
    }
    if (weather.tempC >= 33) {
      return { text: `Día caluroso (${Math.round(weather.tempC)}°). Hidratación arriba`, tone: "weather" };
    }
  }

  // ─── P2: Momento del día / día de la semana ────────────────────────────────
  if (daypart === "noche") {
    const lateNight = [
      `Ya es tarde, ${firstName}. Gracias por seguir al pie del cañón`,
      "Cerrando el día — un repaso rápido y a descansar",
    ];
    return { text: lateNight[seedNum % lateNight.length], tone: "time" };
  }

  if (daypart === "madrugada") {
    return { text: `Arrancando temprano hoy, ${firstName}. Despacio con el café`, tone: "time" };
  }

  if (weekday === 1 && daypart === "manana") {
    return { text: "Lunes a la mañana. Arrancamos la semana", tone: "weekday" };
  }
  if (weekday === 5 && daypart === "tarde") {
    return { text: "Viernes a la tarde — último empujón", tone: "weekday" };
  }
  if ((weekday === 0 || weekday === 6) && daypart === "manana") {
    return { text: "Finde tranquilo, esperemos", tone: "weekday" };
  }

  // ─── P3: Pool rotativo (motivacional 1 de cada 3 días, neutral el resto) ───
  const useMotivational = seedNum % 3 === 0;
  if (useMotivational) {
    const tpl = MOTIVATIONAL_POOL[seedNum % MOTIVATIONAL_POOL.length];
    return { text: tpl(firstName), tone: "neutral" };
  }
  return { text: NEUTRAL_POOL[seedNum % NEUTRAL_POOL.length], tone: "neutral" };
}

