/**
 * La frase de debajo del saludo del Resumen («Buenas tardes, Ignacio»).
 *
 * Es un detalle que el dueño pidió conservar (14/11/2026): el rediseño del
 * Resumen la había sacado. Mezcla el clima (con consejos útiles para el
 * negocio: el aire antes de que llegue alguien, las ventanas antes de la
 * tormenta), el momento del día y de la semana, fechas del calendario y frases
 * para arrancar el día. Puro y determinístico: la misma persona ve la misma
 * frase todo el día (mientras no cambie el clima o la franja), y al día
 * siguiente otra.
 *
 * Cómo se elige: los grupos se miran en orden. El primero que tiene alguna
 * frase para este momento y "sale" ese día (su probabilidad, con una moneda
 * fija por persona y día) es el que habla. Dentro del grupo, las frases rotan
 * por su ciclo (día, semana, mes o año): una frase de los lunes no se repite el
 * lunes siguiente.
 */

export type Audience = "office" | "field" | "owner";

/** El clima de Córdoba, ya resumido (ver `weather.ts`). */
export interface WeatherNow {
  tempC: number;
  /** Máxima de hoy. */
  maxC: number | null;
  /** Mínima de las próximas 12 horas. */
  lowNext12C: number | null;
  /** Lluvia ahora (código WMO de llovizna, lluvia o chaparrón). */
  rainingNow: boolean;
  /** Probabilidad de lluvia ≥ 60 % en las próximas 6 horas. */
  rainSoon: boolean;
  /** Tormenta ahora o en las próximas 6 horas. */
  storm: boolean;
  gustKmh: number | null;
  /** Código WMO de ahora (0 despejado … 3 nublado). */
  code: number | null;
}

/** La hora y la fecha en la zona horaria de la organización. */
export interface LocalClock {
  hour: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  day: number;
  month: number;
  year: number;
  daysInMonth: number;
  /** Días desde 1970-01-01 (fecha local). */
  epochDay: number;
}

export interface GreetingContext {
  /** Nombre de pila, o null si la persona no cargó su nombre. */
  firstName: string | null;
  clock: LocalClock;
  weather: WeatherNow | null;
  audience: Audience;
  /** Llegadas de hoy, si se leyeron (null = no se sabe). */
  arrivalsToday: number | null;
  texEnabled: boolean;
  canSeeMoney: boolean;
  canSettle: boolean;
}

export type LineIcon =
  | "storm"
  | "rain"
  | "umbrella"
  | "heat"
  | "cold"
  | "wind"
  | "sun"
  | "cloud-sun"
  | "moon"
  | "sunrise"
  | "coffee"
  | "lunch"
  | "calendar"
  | "party"
  | "gift"
  | "tree"
  | "heart"
  | "flower"
  | "flag"
  | "star"
  | "bulb"
  | "sparkles"
  | "tex";

export type LineTone = "sky" | "amber" | "orange" | "indigo" | "rose" | "emerald" | "brand" | "muted";

export interface GreetingLine {
  text: string;
  icon: LineIcon;
  tone: LineTone;
  /** El grupo que habló (para tests y para mirar en producción). */
  group: string;
}

type Cycle = "day" | "week" | "month" | "year";

interface LineDef {
  /** `{n}` es el nombre: sin nombre se saca con su coma. `{t}`, `{max}`, `{low}`, `{g}`, `{mes}`, `{mesAnterior}`. */
  text: string;
  /** Default: todos. */
  for?: Audience[];
  when?: (c: GreetingContext) => boolean;
  icon?: LineIcon;
  tone?: LineTone;
}

interface GroupDef {
  id: string;
  /** Si el grupo tiene frases para este momento, cuántos días de cada 100 habla. */
  chance: number | ((c: GreetingContext) => number);
  cycle: Cycle;
  icon: LineIcon;
  tone: LineTone;
  when: (c: GreetingContext) => boolean;
  lines: LineDef[];
}

// ─── Momentos ────────────────────────────────────────────────────────────────

const h = (c: GreetingContext) => c.clock.hour;
const isNight = (c: GreetingContext) => h(c) >= 20;
const isLateNight = (c: GreetingContext) => h(c) < 5;
const isEarly = (c: GreetingContext) => h(c) >= 5 && h(c) < 8;
const isMorning = (c: GreetingContext) => h(c) >= 5 && h(c) < 12;
const isLunch = (c: GreetingContext) => h(c) >= 12 && h(c) < 14;
const isAfternoon = (c: GreetingContext) => h(c) >= 12 && h(c) < 20;
const isDaytime = (c: GreetingContext) => h(c) >= 8 && h(c) < 19;
const someoneArrives = (c: GreetingContext) => c.arrivalsToday !== null && c.arrivalsToday > 0;
/** Alguien llega hoy y todavía hay tiempo de prepararle el depto. */
const arrivalsAhead = (c: GreetingContext) => someoneArrives(c) && h(c) < 18;
const md = (c: GreetingContext, day: number, month: number) => c.clock.day === day && c.clock.month === month;

// ─── El clima ────────────────────────────────────────────────────────────────

/** La máxima que manda: la de hoy, o la de ahora si no hay pronóstico. */
const hottest = (w: WeatherNow) => Math.max(w.tempC, w.maxC ?? w.tempC);
const isHot = (c: GreetingContext) => !!c.weather && hottest(c.weather) >= 32 && h(c) >= 7 && h(c) < 19;
const isColdNow = (c: GreetingContext) => !!c.weather && c.weather.tempC <= 8;
const isFrostTonight = (c: GreetingContext) =>
  !!c.weather && !isColdNow(c) && h(c) >= 16 && c.weather.lowNext12C !== null && c.weather.lowNext12C <= 2;
const isRainNow = (c: GreetingContext) => !!c.weather && c.weather.rainingNow && !c.weather.storm;
const isRainSoon = (c: GreetingContext) => !!c.weather && c.weather.rainSoon && !c.weather.rainingNow && !c.weather.storm;
const isWindy = (c: GreetingContext) => !!c.weather && (c.weather.gustKmh ?? 0) >= 55;
const isNiceDay = (c: GreetingContext) =>
  !!c.weather &&
  isDaytime(c) &&
  c.weather.tempC >= 17 &&
  c.weather.tempC <= 28 &&
  !c.weather.rainingNow &&
  !c.weather.rainSoon &&
  !c.weather.storm &&
  (c.weather.code ?? 99) <= 2;
const isSunny = (c: GreetingContext) => isNiceDay(c) && (c.weather?.code ?? 99) <= 1;

const OFFICE: Audience[] = ["office"];
const STAFF: Audience[] = ["office", "field"];
const OWNER: Audience[] = ["owner"];

/**
 * El catálogo. Las frases van sin punto final, en el castellano de la casa
 * (voseo), y entran en un renglón de la compu. Las viejas siguen todas.
 */
export const GREETING_GROUPS: GroupDef[] = [
  {
    id: "storm",
    chance: 100,
    cycle: "day",
    icon: "storm",
    tone: "sky",
    when: (c) => !!c.weather?.storm,
    lines: [
      { text: "Hay tormenta en el pronóstico — ojo con los huéspedes que llegan", for: OFFICE, when: (c) => c.arrivalsToday !== 0 },
      { text: "Se viene tormenta: si hay balcones con cosas sueltas, mejor entrarlas", for: STAFF },
      { text: "Tormenta en camino. Que las ventanas de los deptos libres queden cerradas", for: STAFF },
      { text: "Hay tormenta en el pronóstico. Si podés, quedate bajo techo" },
      { text: "Se anuncia tormenta. Cuidate si salís, {n}" },
    ],
  },
  {
    id: "fecha",
    chance: 100,
    cycle: "year",
    icon: "party",
    tone: "rose",
    when: () => true,
    lines: [
      { text: "Feliz año nuevo, {n}. Que este año venga lleno de reservas", for: STAFF, when: (c) => md(c, 1, 1) },
      { text: "Feliz año nuevo, {n}. Que sea un gran año", when: (c) => md(c, 1, 1) },
      { text: "Feliz día del trabajador, {n}", when: (c) => md(c, 1, 5), icon: "heart" },
      { text: "Feliz 25 de Mayo, {n}. ¿Locro o empanadas?", when: (c) => md(c, 25, 5), icon: "flag", tone: "sky" },
      { text: "Feliz día de la bandera, {n}", when: (c) => md(c, 20, 6), icon: "flag", tone: "sky" },
      { text: "Feliz día de la independencia, {n}", when: (c) => md(c, 9, 7), icon: "flag", tone: "sky" },
      { text: "Feliz día del amigo, {n}", when: (c) => md(c, 20, 7), icon: "heart" },
      { text: "Feliz día de la primavera, {n}", when: (c) => md(c, 21, 9), icon: "flower", tone: "emerald" },
      { text: "Día mundial del turismo: lo que hacés todos los días es turismo, {n}", for: STAFF, when: (c) => md(c, 27, 9), icon: "star", tone: "amber" },
      { text: "Nochebuena: que la pases lindo, {n}", when: (c) => md(c, 24, 12), icon: "tree", tone: "emerald" },
      { text: "Feliz Navidad, {n}", when: (c) => md(c, 25, 12), icon: "gift" },
      { text: "Último día del año. Gracias por todo lo de este año, {n}", for: STAFF, when: (c) => md(c, 31, 12) },
      { text: "Último día del año: que lo despidas lindo, {n}", for: OWNER, when: (c) => md(c, 31, 12) },
    ],
  },
  {
    id: "clima",
    chance: 100,
    cycle: "day",
    icon: "cloud-sun",
    tone: "sky",
    when: (c) => !!c.weather,
    lines: [
      // Lluvia ahora.
      { text: "Está lloviendo. Si salís, paraguas y sin apuro", when: isRainNow, icon: "umbrella" },
      { text: "Llueve: mandales la ubicación exacta a los que llegan hoy", for: OFFICE, when: (c) => isRainNow(c) && arrivalsAhead(c), icon: "rain" },
      { text: "Con lluvia los huéspedes salen menos y escriben más: paciencia con los mensajes", for: OFFICE, when: isRainNow, icon: "rain" },
      { text: "Día de lluvia: ojo con los pisos mojados en las entradas", for: STAFF, when: isRainNow, icon: "rain" },
      // Lluvia que viene.
      { text: "Dicen que llueve hoy. Llevá paraguas si salís", when: isRainSoon, icon: "umbrella" },
      { text: "Llueve en un rato: mandales la ubicación exacta a los que llegan hoy", for: OFFICE, when: (c) => isRainSoon(c) && arrivalsAhead(c), icon: "rain" },
      { text: "Se viene agua: fijate que las ventanas de los deptos libres queden cerradas", for: STAFF, when: isRainSoon, icon: "rain" },
      { text: "Hay lluvia en el pronóstico: si tenés que salir, mejor ahora", when: isRainSoon, icon: "umbrella" },
      // Calor.
      { text: "Día caluroso ({max}°). Hidratación arriba", when: isHot, icon: "heat", tone: "orange" },
      { text: "Hoy llega a {max}°: prendé el aire de los que entran hoy antes de que lleguen", for: OFFICE, when: (c) => isHot(c) && arrivalsAhead(c), icon: "heat", tone: "orange" },
      { text: "Calor fuerte ({max}°): cortinas cerradas y los deptos vacíos se mantienen frescos", for: STAFF, when: isHot, icon: "heat", tone: "orange" },
      { text: "Con {max}° nadie quiere esperar en la vereda: que las llegadas sean puntuales", for: OFFICE, when: (c) => isHot(c) && arrivalsAhead(c), icon: "heat", tone: "orange" },
      { text: "Hoy hace {max}°: si salís, agua y sombra, {n}", when: isHot, icon: "heat", tone: "orange" },
      // Frío.
      { text: "Hace bastante frío ({t}°). No olvides el abrigo", when: isColdNow, icon: "cold" },
      { text: "Hace frío ({t}°): prendé la calefacción de los que entran hoy antes de que lleguen", for: OFFICE, when: (c) => isColdNow(c) && arrivalsAhead(c), icon: "cold" },
      { text: "Con {t}° afuera, un depto calentito a la llegada se nota en las reseñas", for: STAFF, when: isColdNow, icon: "cold" },
      { text: "Frío de verdad ({t}°). Mate caliente y a trabajar, {n}", for: STAFF, when: isColdNow, icon: "coffee", tone: "amber" },
      { text: "Esta noche hiela ({low}°). Abrigate bien al volver", when: isFrostTonight, icon: "cold" },
      { text: "Esta noche baja a {low}°: que los que llegan tarde encuentren la calefacción prendida", for: OFFICE, when: (c) => isFrostTonight(c) && someoneArrives(c), icon: "cold" },
      // Viento.
      { text: "Viento fuerte hoy (ráfagas de {g} km/h): ojo con las ventanas y los toldos", for: STAFF, when: isWindy, icon: "wind" },
      { text: "Hay viento fuerte. Si salís, cuidado", when: isWindy, icon: "wind" },
    ],
  },
  {
    id: "hora",
    chance: 60,
    cycle: "day",
    icon: "moon",
    tone: "indigo",
    when: (c) => isLateNight(c) || isNight(c) || isEarly(c),
    lines: [
      // Madrugada.
      { text: "Es tardísimo, {n}. Lo que falta, mañana sale", when: isLateNight },
      { text: "¿Trasnochando, {n}? Que no se te haga costumbre", when: isLateNight },
      { text: "A esta hora sólo quedan los búhos y vos, {n}", when: isLateNight },
      { text: "Las reservas no se escapan: andá a descansar, {n}", for: STAFF, when: isLateNight },
      // Noche.
      { text: "Ya es tarde, {n}. Gracias por seguir al pie del cañón", for: STAFF, when: isNight },
      { text: "Cerrando el día — un repaso rápido y a descansar", when: isNight },
      { text: "Buen momento para mirar quién entra mañana y desconectar", for: OFFICE, when: isNight },
      { text: "Lo que no se resolvió hoy, mañana sale", when: isNight },
      { text: "Día cumplido, {n}. Mañana seguimos", for: STAFF, when: isNight },
      { text: "Que tengas una linda noche, {n}", when: isNight },
      { text: "Mañana va a ser otro gran día, {n}", when: isNight },
      { text: "La noche es para descansar: el calendario sigue acá mañana", when: isNight },
      { text: "Gracias por el día de hoy, {n}", for: STAFF, when: isNight },
      // Temprano.
      { text: "Arrancando temprano hoy, {n}. Despacio con el café", when: isEarly, icon: "coffee", tone: "amber" },
      { text: "Madrugaste, {n}. Primero el mate, después las reservas", for: STAFF, when: isEarly, icon: "coffee", tone: "amber" },
      { text: "Temprano y con todo, {n}", when: isEarly, icon: "sunrise", tone: "amber" },
      { text: "El que madruga encuentra el calendario tranquilo", for: OFFICE, when: isEarly, icon: "sunrise", tone: "amber" },
      { text: "Todavía no son las ocho y ya estás acá, {n}", when: isEarly, icon: "sunrise", tone: "amber" },
      { text: "Arranque tranquilo: un repaso de las llegadas y a desayunar", for: OFFICE, when: isEarly, icon: "coffee", tone: "amber" },
      { text: "Primero un café, después el mundo", when: isEarly, icon: "coffee", tone: "amber" },
    ],
  },
  {
    id: "mes",
    // El 1° casi siempre; el aviso de liquidar, día por medio (no es un reto).
    chance: (c) => (c.clock.day === 1 ? 90 : 45),
    cycle: "month",
    icon: "calendar",
    tone: "brand",
    when: (c) => c.clock.day <= 5 || c.clock.day === c.clock.daysInMonth,
    lines: [
      { text: "Arranca {mes}, {n}. Que sea un gran mes", when: (c) => c.clock.day === 1 },
      { text: "Primer día de {mes}: hoja en blanco, {n}", when: (c) => c.clock.day === 1 },
      { text: "Primeros días de {mes}: si todavía no liquidaste {mesAnterior}, es buen momento", for: OFFICE, when: (c) => c.canSettle && c.clock.day >= 2 && c.clock.day <= 5 },
      { text: "Último día de {mes}: buen momento para mirar qué falta cobrar", for: OFFICE, when: (c) => c.canSeeMoney && c.clock.day === c.clock.daysInMonth },
      { text: "Último día de {mes}. Que cierre bien", when: (c) => c.clock.day === c.clock.daysInMonth },
    ],
  },
  {
    id: "semana",
    chance: 30,
    cycle: "week",
    icon: "calendar",
    tone: "indigo",
    when: () => true,
    lines: [
      { text: "Lunes a la mañana. Arrancamos la semana", when: (c) => c.clock.weekday === 1 && isMorning(c) },
      { text: "Arranca la semana, {n}. Con todo", when: (c) => c.clock.weekday === 1 && isMorning(c) },
      { text: "Lunes: buen día para mirar quién entra esta semana", for: OFFICE, when: (c) => c.clock.weekday === 1 && h(c) < 20 },
      { text: "Martes: la semana ya tomó ritmo", when: (c) => c.clock.weekday === 2 && h(c) < 20 },
      { text: "Martes, {n}: buen día para destrabar lo que quedó del lunes", for: STAFF, when: (c) => c.clock.weekday === 2 && h(c) < 20 },
      { text: "Mitad de semana: buen momento para ponerse al día con lo pendiente", for: STAFF, when: (c) => c.clock.weekday === 3 && h(c) < 20 },
      { text: "Miércoles: la semana ya pasó la mitad", when: (c) => c.clock.weekday === 3 && h(c) < 20 },
      { text: "Jueves: se viene el finde, revisá las llegadas del viernes", for: OFFICE, when: (c) => c.clock.weekday === 4 && h(c) < 20 },
      { text: "Jueves: el finde ya se ve", when: (c) => c.clock.weekday === 4 && h(c) < 20 },
      { text: "Viernes: dejá todo listo para las llegadas del finde", for: OFFICE, when: (c) => c.clock.weekday === 5 && isMorning(c) },
      { text: "Viernes, {n}. Último empujón de la semana", when: (c) => c.clock.weekday === 5 && isMorning(c) },
      { text: "Viernes a la tarde — último empujón", when: (c) => c.clock.weekday === 5 && isAfternoon(c) },
      { text: "Viernes a la tarde: el finde está a la vuelta", when: (c) => c.clock.weekday === 5 && isAfternoon(c) },
      { text: "Viernes: que las llegadas del finde encuentren todo listo", for: OFFICE, when: (c) => c.clock.weekday === 5 && isAfternoon(c) },
      { text: "Finde tranquilo, esperemos", when: (c) => (c.clock.weekday === 0 || c.clock.weekday === 6) && isMorning(c) },
      { text: "Sábado de recambios: que cada depto quede impecable", for: STAFF, when: (c) => c.clock.weekday === 6 && h(c) < 20 },
      { text: "¿Trabajando el finde, {n}? Gracias por estar", for: STAFF, when: (c) => (c.clock.weekday === 0 || c.clock.weekday === 6) && h(c) < 20 },
      { text: "Domingo: que sea tranquilo, {n}", when: (c) => c.clock.weekday === 0 && h(c) < 20 },
      { text: "Domingo a la noche: mañana arranca otra semana", when: (c) => c.clock.weekday === 0 && isNight(c), icon: "moon" },
    ],
  },
  {
    id: "almuerzo",
    chance: 40,
    cycle: "day",
    icon: "lunch",
    tone: "amber",
    when: isLunch,
    lines: [
      { text: "Hora de almorzar, {n}. El calendario te espera" },
      { text: "No te saltees el almuerzo, {n}" },
      { text: "Mediodía: un repaso de la mañana y a comer algo" },
    ],
  },
  {
    id: "dia-lindo",
    chance: 30,
    cycle: "day",
    icon: "sun",
    tone: "amber",
    when: isNiceDay,
    lines: [
      { text: "Lindo día: {t}° y sin lluvia" },
      { text: "{t}° y sol: buen día para ventilar los deptos que están libres", for: STAFF, when: isSunny },
      { text: "Día lindo en Córdoba ({t}°). Que se note en el humor", when: isSunny },
      { text: "{t}° y sin lluvia: día ideal para las limpiezas a fondo", for: STAFF },
    ],
  },
  {
    id: "consejo",
    chance: 35,
    cycle: "day",
    icon: "bulb",
    tone: "amber",
    when: (c) => c.audience !== "owner",
    lines: [
      { text: "Un mensaje el día antes de la llegada ahorra tres llamadas el día de la llegada", for: OFFICE },
      { text: "Responder rápido es la mitad de una buena reseña", for: OFFICE },
      { text: "Un depto impecable es la mejor bienvenida", for: STAFF },
      { text: "Las buenas reseñas se ganan en los detalles", for: STAFF },
      { text: "Cargá los cobros el mismo día: a fin de mes te lo agradecés", for: OFFICE, when: (c) => c.canSeeMoney },
      { text: "Detrás de cada llegada hay un viaje: hagámoslo fácil", for: STAFF },
      { text: "Si algo se rompe, cargalo como ticket en el momento: después nadie se acuerda", for: STAFF },
      { text: "Una reserva con todos los datos es un problema menos a fin de mes", for: OFFICE },
      { text: "El huésped que se siente esperado vuelve", for: STAFF },
      { text: "Una foto del depto al terminar la limpieza evita discusiones después", for: STAFF },
    ],
  },
  {
    id: "tex",
    chance: 15,
    cycle: "day",
    icon: "tex",
    tone: "sky",
    when: (c) => c.texEnabled && c.audience === "office",
    lines: [
      { text: "Probá preguntarle a Tex: «¿qué hay libre este finde?»" },
      { text: "¿Quién entra mañana? Tex te lo dice en un segundo" },
      { text: "Tex conoce tus reservas: preguntale lo que necesites" },
      { text: "Preguntale a Tex cómo viene la caja del mes", when: (c) => c.canSeeMoney },
    ],
  },
  {
    id: "animo",
    chance: 100,
    cycle: "day",
    icon: "sparkles",
    tone: "muted",
    when: () => true,
    lines: [
      { text: "Espero que tengas un día tranquilo", when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Que rinda el día", when: (c) => h(c) >= 5 && h(c) < 17 },
      { text: "Un día a la vez" },
      { text: "Hagamos que valga la pena" },
      { text: "Vamos con todo" },
      { text: "Vos podés, {n}" },
      { text: "Confío en vos, {n}" },
      { text: "{n}, hoy es un buen día para destrabar cosas", when: (c) => h(c) >= 5 && h(c) < 20 },
      { text: "Paso a paso, sin apuro pero sin pausa" },
      { text: "Que hoy salga todo redondo", when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Lo importante primero; lo demás, después" },
      { text: "Respirá hondo: todo tiene solución" },
      { text: "Con calma y buena onda, sale todo" },
      { text: "Gracias por cuidar cada detalle, {n}", for: STAFF },
      { text: "Lo que hacés se nota en cada llegada", for: STAFF },
      { text: "Que sea un día sin sorpresas", when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "A paso firme, {n}" },
      { text: "Hoy es un gran día para tachar pendientes", for: STAFF, when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Primero lo urgente, después lo importante y al final un café" },
      { text: "Hoy se resuelve, {n}", for: STAFF },
      { text: "Buena energía para hoy, {n}", when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Un buen equipo hace fácil lo difícil", for: STAFF },
      { text: "Que el día te trate bien, {n}", when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Cada huésped contento es una buena reseña en camino", for: STAFF },
      { text: "Todo lo de tus deptos, en un solo lugar", for: OWNER },
      { text: "Que tengas un lindo día, {n}", for: OWNER, when: (c) => h(c) >= 5 && h(c) < 18 },
      { text: "Acá tenés cómo vienen tus unidades", for: OWNER },
    ],
  },
];

// ─── Elegir ──────────────────────────────────────────────────────────────────

/** djb2: estable entre renders, entre servidores y entre deploys. */
export function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function cycleIndex(cycle: Cycle, clock: LocalClock): number {
  switch (cycle) {
    case "day":
      return clock.epochDay;
    // 1/1/1970 fue jueves: +3 hace que la semana arranque el lunes.
    case "week":
      return Math.floor((clock.epochDay + 3) / 7);
    case "month":
      return clock.year * 12 + clock.month;
    case "year":
      return clock.year;
  }
}

function lineApplies(line: LineDef, c: GreetingContext): boolean {
  if (line.for && !line.for.includes(c.audience)) return false;
  return !line.when || line.when(c);
}

/**
 * Elige la frase. `seed` identifica a la persona (su id): dos personas del
 * mismo equipo no ven siempre la misma.
 */
export function pickGreetingLine(c: GreetingContext, seed: string): GreetingLine {
  const dayKey = `${seed}|${c.clock.epochDay}`;
  for (const group of GREETING_GROUPS) {
    if (!group.when(c)) continue;
    const lines = group.lines.filter((l) => lineApplies(l, c));
    if (lines.length === 0) continue;
    const chance = typeof group.chance === "function" ? group.chance(c) : group.chance;
    if (chance < 100 && hashString(`${dayKey}|${group.id}`) % 100 >= chance) continue;
    const index = (cycleIndex(group.cycle, c.clock) + hashString(`${seed}|${group.id}`)) % lines.length;
    const line = lines[index];
    return {
      text: fillLine(line.text, c),
      icon: line.icon ?? group.icon,
      tone: line.tone ?? group.tone,
      group: group.id,
    };
  }
  // El último grupo siempre tiene frases para todos: esto no debería pasar.
  return { text: "Un día a la vez", icon: "sparkles", tone: "muted", group: "animo" };
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Completa una frase. Sin nombre, `{n}` se va con su coma ("Vos podés, {n}" → "Vos podés"). */
export function fillLine(template: string, c: Pick<GreetingContext, "firstName" | "clock" | "weather">): string {
  const w = c.weather;
  const values: Record<string, string> = {
    t: w ? String(Math.round(w.tempC)) : "",
    max: w ? String(Math.round(hottest(w))) : "",
    low: w && w.lowNext12C !== null ? String(Math.round(w.lowNext12C)) : "",
    g: w && w.gustKmh !== null ? String(Math.round(w.gustKmh)) : "",
    mes: MONTHS[c.clock.month - 1],
    mesAnterior: MONTHS[(c.clock.month + 10) % 12],
  };
  let text = template;
  if (c.firstName) {
    text = text.replaceAll("{n}", c.firstName);
  } else {
    text = text
      .replace(/^\{n\},\s*(.)/, (_, first: string) => first.toLocaleUpperCase("es-AR"))
      .replace(/,\s*\{n\}/g, "")
      .replace(/\{n\}/g, "");
  }
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

// ─── El reloj de la organización ─────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** La hora y la fecha de `now` en la zona horaria de la organización. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  return {
    hour,
    weekday: WEEKDAYS.indexOf(get("weekday")),
    day,
    month,
    year,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    epochDay: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
  };
}

/** «Buenos días» de 5 a 12, «Buenas tardes» hasta las 20, «Buenas noches» el resto. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** El nombre de pila, con mayúscula inicial ("IGNACIO" → "Ignacio"); null si no hay. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toLocaleUpperCase("es-AR") + first.slice(1).toLocaleLowerCase("es-AR");
}
