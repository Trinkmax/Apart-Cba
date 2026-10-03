import type { IndexFrequency } from "./schedule";
import { addDays, addMonthsToMonth, monthOf } from "./ymd";

/**
 * Índices de actualización de alquileres.
 *
 * Los valores son datos públicos e iguales para todas las organizaciones:
 * viven en una tabla global (`economic_indices`) que llena el cron diario.
 * Se guarda el NIVEL del índice (no la variación), así cualquier ajuste es un
 * cociente de dos niveles y no depende de redondeos de porcentajes mensuales.
 *
 * Claves: índice mensual → `YYYY-MM-01` (el mes al que corresponde el dato);
 * índice diario → `YYYY-MM-DD`.
 *
 * Excepción: Casa Propia no publica un nivel sino un COEFICIENTE por mes
 * (1,0281 = +2,81 % en ese mes). Se guarda tal como sale y se encadena en
 * memoria (`CoefficientSeries`): el motor sigue viendo niveles.
 */

export type IndexCode = "ipc" | "icl" | "casa_propia" | "uva" | "cer" | "ripte";

export const INDEX_CODES: IndexCode[] = ["ipc", "icl", "casa_propia", "uva", "cer", "ripte"];

export interface IndexMeta {
  /** Sigla corta para chips y tablas. */
  label: string;
  /** Nombre completo, como figura en los contratos. */
  name: string;
  publisher: string;
  frequency: IndexFrequency;
  /** Una línea para la persona que elige el índice en el alta del contrato. */
  hint: string;
  /**
   * Cómo sale publicado: el nivel del índice, o el coeficiente de cada mes
   * (Casa Propia). Decide cómo se carga a mano y cómo se arma la serie.
   */
  publishedAs: "level" | "monthly_coefficient";
}

export const INDEX_META: Record<IndexCode, IndexMeta> = {
  ipc: {
    label: "IPC",
    name: "Índice de Precios al Consumidor",
    publisher: "INDEC",
    frequency: "monthly",
    hint: "La inflación mensual. El más usado desde 2024.",
    publishedAs: "level",
  },
  icl: {
    label: "ICL",
    name: "Índice para Contratos de Locación",
    publisher: "BCRA",
    frequency: "daily",
    hint: "Mitad inflación, mitad salarios. Lo publica el Banco Central todos los días.",
    publishedAs: "level",
  },
  casa_propia: {
    label: "Casa Propia",
    name: "Coeficiente Casa Propia",
    publisher: "Ministerio de Desarrollo Territorial y Hábitat",
    frequency: "monthly",
    hint: "Toma el menor entre inflación y salarios.",
    publishedAs: "monthly_coefficient",
  },
  uva: {
    label: "UVA",
    name: "Unidad de Valor Adquisitivo",
    publisher: "BCRA",
    frequency: "daily",
    hint: "Sigue al CER (inflación) día a día.",
    publishedAs: "level",
  },
  cer: {
    label: "CER",
    name: "Coeficiente de Estabilización de Referencia",
    publisher: "BCRA",
    frequency: "daily",
    hint: "Inflación diaria del Banco Central.",
    publishedAs: "level",
  },
  ripte: {
    label: "RIPTE",
    name: "Remuneración Imponible Promedio de los Trabajadores Estables",
    publisher: "Secretaría de Seguridad Social",
    frequency: "monthly",
    hint: "Evolución de los salarios formales.",
    publishedAs: "level",
  },
};

export function isIndexCode(v: unknown): v is IndexCode {
  return typeof v === "string" && (INDEX_CODES as string[]).includes(v);
}

export function indexFrequency(code: IndexCode): IndexFrequency {
  return INDEX_META[code].frequency;
}

/** true si el índice se publica como coeficiente mensual (Casa Propia) y no como nivel. */
export function isCoefficientIndex(code: IndexCode): boolean {
  return INDEX_META[code].publishedAs === "monthly_coefficient";
}

/**
 * Rango aceptado para un coeficiente mensual: deja afuera un porcentaje
 * tipeado como coeficiente (2,81) y un nivel (105,3). Exclusivo en ambos bordes.
 */
export const MONTHLY_COEFFICIENT_RANGE = { min: 0.8, max: 1.5 } as const;

export interface IndexPoint {
  /** `YYYY-MM-01` (mensual) o `YYYY-MM-DD` (diario). */
  date: string;
  value: number;
}

/** Las dos puntas de una ventana de ajuste, o las claves que faltan para calcularla. */
export type IndexWindowLookup =
  | { ok: true; fromValue: number; toValue: number }
  | { ok: false; missing: string[] };

/** Lo único que el motor de ajustes necesita de una serie. */
export interface IndexLookup {
  /** Valor exacto o el aceptable más cercano; undefined si todavía no se publicó. */
  get(key: string): number | undefined;
  /** Último dato disponible (o null si la serie está vacía). */
  readonly lastDate: string | null;
  /**
   * Las dos puntas de una ventana, comparables entre sí. Sólo la tienen las
   * series en las que leer cada punta con `get()` no alcanza (Casa Propia:
   * un mes faltante corta la cadena y lo que importa es que las dos puntas
   * queden del mismo lado del hueco). Se usa a través de `lookupWindow()`.
   */
  windowValues?(fromKey: string, toKey: string): IndexWindowLookup;
}

/**
 * Las dos puntas de un ajuste, para cualquier serie: lo que usa el motor.
 * `missing` son las claves sin dato, en orden: en un índice de nivel, la
 * punta que falta; en Casa Propia, los meses de la ventana sin coeficiente.
 */
export function lookupWindow(series: IndexLookup | null | undefined, fromKey: string, toKey: string): IndexWindowLookup {
  if (series?.windowValues) return series.windowValues(fromKey, toKey);
  const fromValue = series?.get(fromKey);
  const toValue = series?.get(toKey);
  if (fromValue !== undefined && toValue !== undefined) return { ok: true, fromValue, toValue };
  const missing = [fromValue === undefined ? fromKey : null, toValue === undefined ? toKey : null];
  return { ok: false, missing: missing.filter((k): k is string => k !== null) };
}

/**
 * Serie en memoria. Para índices diarios tolera huecos chicos (feriados o un
 * día sin publicar) usando el último valor anterior — pero SÓLO si la fecha
 * pedida es anterior al último dato: una fecha futura es "todavía no salió",
 * nunca "usá el de ayer".
 */
export class IndexSeries implements IndexLookup {
  private readonly values = new Map<string, number>();
  readonly lastDate: string | null;

  constructor(
    points: IndexPoint[],
    private readonly frequency: IndexFrequency,
    private readonly maxGapDays = 7,
  ) {
    let last: string | null = null;
    for (const p of points) {
      if (!Number.isFinite(p.value) || p.value <= 0) continue;
      this.values.set(p.date, p.value);
      if (!last || p.date > last) last = p.date;
    }
    this.lastDate = last;
  }

  get(key: string): number | undefined {
    const exact = this.values.get(key);
    if (exact !== undefined || this.frequency === "monthly") return exact;
    if (!this.lastDate || key > this.lastDate) return undefined;
    for (let i = 1; i <= this.maxGapDays; i++) {
      const v = this.values.get(addDays(key, -i));
      if (v !== undefined) return v;
    }
    return undefined;
  }

  get size(): number {
    return this.values.size;
  }
}

/**
 * Serie de un índice que se publica como coeficiente mensual (Casa Propia).
 * Recibe los coeficientes tal como salen y los encadena como nivel: el mes
 * anterior al primero vale 1 y cada mes vale el anterior × su coeficiente.
 * Así nivel(hasta) ÷ nivel(desde) = producto de los coeficientes de
 * desde+1 … hasta, que es el ajuste, y el punto de partida no importa.
 *
 * Con un mes faltante no se puede encadenar a través de él: la serie queda
 * partida en tramos sin huecos, cada uno con su propio nivel 1. Una ventana
 * se calcula si sus dos puntas caen en el mismo tramo (`windowValues()`); si
 * cruza el hueco queda "esperando el índice" — nunca se saltea un mes en silencio,
 * que daría un aumento menor al real —, y un hueco fuera de la ventana (antes
 * o después) no la frena: cargar junio antes que mayo no puede trabar un
 * ajuste que va de octubre a abril.
 *
 * `get()` sigue devolviendo sólo el último tramo (gráfico, resumen de la
 * tarjeta): dos niveles de tramos distintos no se pueden dividir entre sí.
 */
export class CoefficientSeries implements IndexLookup {
  /** Niveles del último tramo sin huecos: lo que devuelve `get()`. */
  private readonly levels = new Map<string, number>();
  /** Nivel de cada mes dentro de SU tramo (cada uno arranca en 1) y a qué tramo pertenece. */
  private readonly runLevels = new Map<string, { run: number; level: number }>();
  /** Meses con coeficiente cargado. */
  private readonly loaded = new Set<string>();
  readonly lastDate: string | null;
  /** Primer mes del último tramo (su ancla, nivel 1, es el mes anterior). */
  readonly firstDate: string | null;

  constructor(points: IndexPoint[]) {
    const coefs = new Map<string, number>();
    for (const p of points) {
      if (!Number.isFinite(p.value) || p.value <= 0) continue;
      coefs.set(monthOf(p.date), p.value);
    }
    const months = [...coefs.keys()].sort();
    if (!months.length) {
      this.lastDate = null;
      this.firstDate = null;
      return;
    }
    let run = -1;
    let runStart = 0;
    let level = 1;
    for (let i = 0; i < months.length; i++) {
      // Un mes que no sigue al anterior abre un tramo nuevo, anclado en 1 en
      // el mes de antes (que es el hueco: nunca pertenece a otro tramo).
      if (i === 0 || addMonthsToMonth(months[i - 1], 1) !== months[i]) {
        run++;
        runStart = i;
        level = 1;
        this.runLevels.set(addMonthsToMonth(months[i], -1), { run, level });
      }
      level *= coefs.get(months[i]) as number;
      this.runLevels.set(months[i], { run, level });
      this.loaded.add(months[i]);
    }
    for (const [m, v] of this.runLevels) if (v.run === run) this.levels.set(m, v.level);
    this.firstDate = months[runStart];
    this.lastDate = months[months.length - 1];
  }

  get(key: string): number | undefined {
    return this.levels.get(key);
  }

  windowValues(fromKey: string, toKey: string): IndexWindowLookup {
    const from = this.runLevels.get(monthOf(fromKey));
    const to = this.runLevels.get(monthOf(toKey));
    if (from && to && from.run === to.run) return { ok: true, fromValue: from.level, toValue: to.level };
    return { ok: false, missing: this.missingIn(fromKey, toKey) };
  }

  /** Meses de la ventana (desde+1 … hasta) sin coeficiente cargado. */
  private missingIn(fromKey: string, toKey: string): string[] {
    const to = monthOf(toKey);
    const out: string[] = [];
    for (let m = addMonthsToMonth(fromKey, 1), i = 0; m <= to && i < 600; m = addMonthsToMonth(m, 1), i++) {
      if (!this.loaded.has(m)) out.push(m);
    }
    return out.length ? out : [to];
  }
}

/** La serie que corresponde según cómo se publica el índice (nivel o coeficiente mensual). */
export function seriesFromPoints(code: IndexCode, points: IndexPoint[]): IndexLookup {
  return isCoefficientIndex(code) ? new CoefficientSeries(points) : new IndexSeries(points, indexFrequency(code));
}

/** Meses sin dato entre el primero y el último de la lista (claves `YYYY-MM-01`, en orden). */
export function missingMonths(months: string[]): string[] {
  const have = new Set(months.map(monthOf));
  const sorted = [...have].sort();
  const out: string[] = [];
  if (sorted.length < 2) return out;
  for (let m = addMonthsToMonth(sorted[0], 1); m < sorted[sorted.length - 1]; m = addMonthsToMonth(m, 1)) {
    if (!have.has(m)) out.push(m);
  }
  return out;
}

/**
 * Qué meses hay cargados de un índice que se carga mes a mes (Casa Propia):
 * el primero, el último y los que faltan en el medio. Es chico y viaja a las
 * pantallas, que así nombran el mes que frena un ajuste sin leer la serie.
 */
export interface MonthCoverage {
  first: string;
  last: string;
  gaps: string[];
}

export function monthCoverage(keys: string[]): MonthCoverage | null {
  const months = [...new Set(keys.map(monthOf))].sort();
  if (!months.length) return null;
  return { first: months[0], last: months[months.length - 1], gaps: missingMonths(months) };
}

/**
 * El mes sin coeficiente más reciente de una ventana (desde+1 … hasta): el
 * que hay que nombrar en un ajuste que espera Casa Propia. La ventana se
 * calcula por tramos (`windowValues()`), así que si espera es porque le
 * falta un mes adentro: `toKey` si todavía no se cargó, o un hueco del medio
 * — nunca un mes que ya está. Sin `fromKey` no se miran los meses anteriores
 * al primero cargado (no se sabe si la ventana los usa).
 * null = a la ventana no le falta ningún mes de los que se ven. Con `fromKey`
 * eso quiere decir que el ajuste ya se puede calcular y lo frena otra cosa:
 * la corrida de la noche (el índice es de todas las inmobiliarias y al
 * cargarlo sólo se recalcula la de quien lo cargó) o un ajuste anterior.
 */
export function lastMissingMonthIn(
  fromKey: string | null | undefined,
  toKey: string,
  coverage: MonthCoverage | null | undefined,
): string | null {
  const to = monthOf(toKey);
  const from = fromKey ? monthOf(fromKey) : null;
  if (!coverage || to > coverage.last || to < coverage.first) return to;
  const inWindow = coverage.gaps.filter((g) => g <= to && (from === null || g > from)).sort();
  if (inWindow.length) return inWindow[inWindow.length - 1];
  const beforeFirst = addMonthsToMonth(coverage.first, -1);
  return from !== null && from < beforeFirst ? beforeFirst : null;
}
