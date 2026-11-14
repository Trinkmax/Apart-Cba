import { describe, expect, it } from "vitest";
import {
  GREETING_GROUPS,
  fillLine,
  firstNameOf,
  greetingFor,
  localClock,
  pickGreetingLine,
  type Audience,
  type GreetingContext,
  type WeatherNow,
} from "../lines";
import { summarizeWeather } from "../weather-summary";

const TZ = "America/Argentina/Cordoba";

/** Una fecha local de Córdoba (UTC−3) a una hora dada. */
function at(ymd: string, hour: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return localClock(new Date(Date.UTC(y, m - 1, d, hour + 3, 30)), TZ);
}

const mild: WeatherNow = {
  tempC: 22,
  maxC: 25,
  lowNext12C: 15,
  rainingNow: false,
  rainSoon: false,
  storm: false,
  gustKmh: 15,
  code: 3,
};

function ctx(over: Partial<GreetingContext> = {}): GreetingContext {
  return {
    firstName: "Ignacio",
    clock: at("2026-11-11", 10), // miércoles
    weather: null,
    audience: "office",
    arrivalsToday: 3,
    texEnabled: true,
    canSeeMoney: true,
    canSettle: true,
    ...over,
  };
}

describe("localClock", () => {
  it("usa la hora de la organización, no la del servidor (UTC)", () => {
    // 02:30 UTC del domingo 15 = 23:30 del sábado 14 en Córdoba.
    const clock = localClock(new Date("2026-11-15T02:30:00Z"), TZ);
    expect(clock).toMatchObject({ hour: 23, weekday: 6, day: 14, month: 11, year: 2026, daysInMonth: 30 });
  });

  it("cuenta los días seguidos", () => {
    expect(at("2026-11-15", 9).epochDay - at("2026-11-14", 9).epochDay).toBe(1);
    expect(at("2028-02-10", 9).daysInMonth).toBe(29);
  });
});

describe("greetingFor", () => {
  it("días hasta el mediodía, tardes hasta las 20, noches el resto", () => {
    expect(greetingFor(5)).toBe("Buenos días");
    expect(greetingFor(11)).toBe("Buenos días");
    expect(greetingFor(12)).toBe("Buenas tardes");
    expect(greetingFor(19)).toBe("Buenas tardes");
    expect(greetingFor(20)).toBe("Buenas noches");
    expect(greetingFor(2)).toBe("Buenas noches");
  });
});

describe("firstNameOf", () => {
  it("el nombre de pila con mayúscula inicial", () => {
    expect(firstNameOf("IGNACIO BALDOVINO")).toBe("Ignacio");
    expect(firstNameOf("  cecilia  ")).toBe("Cecilia");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe("fillLine", () => {
  const base = { clock: at("2026-11-02", 10), weather: mild };

  it("sin nombre, el nombre se va con su coma", () => {
    expect(fillLine("Vos podés, {n}", { ...base, firstName: null })).toBe("Vos podés");
    expect(fillLine("{n}, hoy es un buen día", { ...base, firstName: null })).toBe("Hoy es un buen día");
    expect(fillLine("¿Trasnochando, {n}? Que no", { ...base, firstName: null })).toBe("¿Trasnochando? Que no");
    expect(fillLine("Vos podés, {n}", { ...base, firstName: "Ana" })).toBe("Vos podés, Ana");
  });

  it("el mes y el anterior, también en enero", () => {
    expect(fillLine("{mes} / {mesAnterior}", { ...base, firstName: null })).toBe("noviembre / octubre");
    expect(fillLine("{mes} / {mesAnterior}", { ...base, firstName: null, clock: at("2027-01-03", 10) })).toBe(
      "enero / diciembre",
    );
  });
});

describe("pickGreetingLine", () => {
  it("es la misma todo el día para la misma persona", () => {
    const a = pickGreetingLine(ctx({ clock: at("2026-11-11", 9) }), "user-1");
    const b = pickGreetingLine(ctx({ clock: at("2026-11-11", 10) }), "user-1");
    expect(a).toEqual(b);
  });

  it("cambia de un día al otro: en dos meses aparecen muchas frases distintas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const clock = localClock(new Date(Date.UTC(2026, 10, 1 + i, 13, 30)), TZ); // 10:30 en Córdoba
      seen.add(pickGreetingLine(ctx({ clock, weather: mild }), "user-1").text);
    }
    expect(seen.size).toBeGreaterThanOrEqual(25);
  });

  it("la tormenta gana siempre", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const line = pickGreetingLine(ctx({ weather: { ...mild, storm: true } }), seed);
      expect(line.group).toBe("storm");
      expect(line.icon).toBe("storm");
    }
  });

  it("si llueve en un rato, habla de la lluvia", () => {
    const line = pickGreetingLine(ctx({ weather: { ...mild, rainSoon: true } }), "user-1");
    expect(line.group).toBe("clima");
    expect(line.text).toMatch(/llueve|agua|lluvia/i);
  });

  it("con calor dice la máxima del día, no la de ahora", () => {
    const hot = { ...mild, tempC: 26, maxC: 35.4 };
    const texts = ["a", "b", "c", "d", "e", "f"].map((s) => pickGreetingLine(ctx({ weather: hot }), s).text);
    expect(texts.every((t) => t.includes("35°"))).toBe(true);
  });

  it("navidad gana sobre el clima", () => {
    const line = pickGreetingLine(ctx({ clock: at("2026-12-25", 11), weather: { ...mild, rainSoon: true } }), "u");
    expect(line.text).toBe("Feliz Navidad, Ignacio");
  });

  it("a la madrugada no le desea que rinda el día", () => {
    for (let i = 0; i < 40; i++) {
      const clock = localClock(new Date(Date.UTC(2026, 10, 1 + i, 5, 0)), TZ); // 02:00
      const line = pickGreetingLine(ctx({ clock }), "user-1");
      expect(line.text).not.toMatch(/rinda el día|día tranquilo|buena energía/i);
    }
  });

  it("el propietario no recibe consejos de la operación ni de Tex", () => {
    for (let i = 0; i < 120; i++) {
      const clock = localClock(new Date(Date.UTC(2026, 0, 1 + i, 13 + (i % 10), 0)), TZ);
      const weather = i % 3 === 0 ? { ...mild, rainSoon: true } : i % 3 === 1 ? { ...mild, tempC: 5 } : mild;
      const line = pickGreetingLine(ctx({ clock, weather, audience: "owner", arrivalsToday: null }), `o${i}`);
      expect(["consejo", "tex"]).not.toContain(line.group);
      expect(line.text).not.toMatch(/llegan hoy|entran hoy|deptos libres|cobrar|liquid/i);
    }
  });

  it("sin Tex, nunca lo nombra; sin permiso de plata, nunca habla de cobros", () => {
    for (let i = 0; i < 200; i++) {
      const clock = localClock(new Date(Date.UTC(2026, 0, 1 + i, 12 + (i % 11), 0)), TZ);
      const line = pickGreetingLine(ctx({ clock, texEnabled: false, canSeeMoney: false, canSettle: false }), `s${i}`);
      expect(line.text).not.toMatch(/Tex|cobr|liquid/);
    }
  });

  it("sin llegadas hoy no pide preparar a los que llegan", () => {
    const weathers: WeatherNow[] = [
      { ...mild, rainSoon: true },
      { ...mild, tempC: 4 },
      { ...mild, maxC: 36 },
    ];
    for (const weather of weathers) {
      for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
        const line = pickGreetingLine(ctx({ weather, arrivalsToday: 0 }), seed);
        expect(line.text).not.toMatch(/llegan hoy|entran hoy/);
      }
    }
  });
});

describe("el catálogo", () => {
  const audiences: Audience[] = ["office", "field", "owner"];
  const clocks = [at("2026-11-02", 10), at("2027-01-01", 6), at("2026-11-30", 21), at("2026-11-14", 3)];
  const weathers: (WeatherNow | null)[] = [
    null,
    mild,
    { ...mild, tempC: 3, lowNext12C: -1, gustKmh: 70 },
    { ...mild, tempC: 30, maxC: 37, rainingNow: true },
  ];

  it("cada frase se completa entera, entra en un renglón y sin punto final", () => {
    for (const group of GREETING_GROUPS) {
      for (const line of group.lines) {
        for (const clock of clocks) {
          for (const weather of weathers) {
            for (const firstName of ["Maximiliano", null]) {
              const text = fillLine(line.text, { firstName, clock, weather: weather ?? mild });
              expect(text, line.text).not.toMatch(/[{}]|,\s*[,.?]|^\s|\s$|\s{2}/);
              expect(text.length, text).toBeLessThanOrEqual(95);
              expect(text.endsWith("."), text).toBe(false);
            }
          }
        }
      }
    }
  });

  it("siempre hay una frase, para cualquiera, a cualquier hora", () => {
    for (const audience of audiences) {
      for (let hour = 0; hour < 24; hour++) {
        const line = pickGreetingLine(ctx({ audience, clock: at("2026-11-11", hour), texEnabled: false }), "x");
        expect(line.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("hay muchas más que antes (eran 18)", () => {
    const total = GREETING_GROUPS.reduce((n, g) => n + g.lines.length, 0);
    expect(total).toBeGreaterThanOrEqual(100);
  });
});

describe("summarizeWeather", () => {
  it("resume la respuesta de Open-Meteo", () => {
    const w = summarizeWeather({
      current: { temperature_2m: 22.9, weather_code: 3, wind_gusts_10m: 18.4 },
      hourly: {
        temperature_2m: [22.9, 21.9, 20.5, 19.8, 18.9, 18.3, 17.9, 17.7, 16.9, 15.7, 15.2, 15.8, 3],
        precipitation_probability: [1, 0, 0, 0, 0, 70, 90],
        weather_code: [3, 2, 2, 3, 3, 3, 95],
      },
      daily: { temperature_2m_max: [31.2] },
    });
    expect(w).toEqual({
      tempC: 22.9,
      maxC: 31.2,
      lowNext12C: 15.2, // sólo 12 horas
      rainingNow: false,
      rainSoon: true, // 70 % dentro de las 6 horas
      storm: false, // el 95 cae en la hora 7
      gustKmh: 18.4,
      code: 3,
    });
  });

  it("lluvia y tormenta de ahora", () => {
    expect(summarizeWeather({ current: { temperature_2m: 18, weather_code: 63 } })?.rainingNow).toBe(true);
    expect(summarizeWeather({ current: { temperature_2m: 18, weather_code: 95 } })?.storm).toBe(true);
  });

  it("sin temperatura no sirve", () => {
    expect(summarizeWeather({})).toBeNull();
    expect(summarizeWeather({ current: { weather_code: 1 } })).toBeNull();
  });
});
