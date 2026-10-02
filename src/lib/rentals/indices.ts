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

/** Lo único que el motor de ajustes necesita de una serie. */
export interface IndexLookup {
  /** Valor exacto o el aceptable más cercano; undefined si todavía no se publicó. */
  get(key: string): number | undefined;
  /** Último dato disponible (o null si la serie está vacía). */
  readonly lastDate: string | null;
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
 * Con un mes faltante no se puede encadenar a través de él: se usa sólo el
 * último tramo sin huecos (lo que importa son los ajustes que vienen). Un
 * ajuste que necesita meses de antes del hueco queda "esperando el índice";
 * nunca se saltea un mes en silencio, que daría un aumento menor al real.
 */
export class CoefficientSeries implements IndexLookup {
  private readonly levels = new Map<string, number>();
  readonly lastDate: string | null;
  /** Primer mes del tramo que se usa (su ancla, nivel 1, es el mes anterior). */
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
    let start = months.length - 1;
    while (start > 0 && addMonthsToMonth(months[start - 1], 1) === months[start]) start--;
    let level = 1;
    this.levels.set(addMonthsToMonth(months[start], -1), level);
    for (let i = start; i < months.length; i++) {
      level *= coefs.get(months[i]) as number;
      this.levels.set(months[i], level);
    }
    this.firstDate = months[start];
    this.lastDate = months[months.length - 1];
  }

  get(key: string): number | undefined {
    return this.levels.get(key);
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
