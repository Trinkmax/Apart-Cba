import { addDays, addMonthsClamped, addMonthsToMonth, minYmd, monthOf } from "./ymd";

/**
 * Cronograma de un contrato de alquiler tradicional.
 *
 * Un contrato de 24 meses tiene 24 PERÍODOS mensuales que arrancan el mismo
 * día que el contrato (contrato del 01/03 → períodos 01/03–31/03, 01/04–30/04…;
 * contrato del 15/03 → 15/03–14/04, 15/04–14/05…). Se paga por período
 * adelantado: el vencimiento cae dentro de los primeros N días del período
 * ("del 1 al 10" cuando el contrato arranca el día 1).
 *
 * Los períodos se agrupan en CICLOS de ajuste: con ajuste trimestral el ciclo
 * 1 son los períodos 1-3, el ciclo 2 los 4-6, etc. En el primer período de
 * cada ciclo ≥ 2 rige un precio nuevo. Cada período se muestra como
 * "Período 2/3" — la misma convención que ya usan las liquidaciones a
 * propietarios (ver `src/lib/settlements/labels.ts`, migración 046).
 */

export interface ScheduleInput {
  /** Inicio del contrato, YYYY-MM-DD. */
  startDate: string;
  /** Duración en meses (24 = dos años). */
  durationMonths: number;
  /** Cada cuántos meses se actualiza el precio. null o 0 = nunca. */
  adjustmentEveryMonths: number | null;
  /** Plazo para pagar, en días desde el inicio del período (10 = "del 1 al 10"). */
  paymentWindowDays: number;
}

export interface SchedulePeriod {
  /** 1-based. */
  index: number;
  start: string;
  /** Inclusivo: el día anterior al inicio del período siguiente. */
  end: string;
  /** Último día para pagar sin mora. Nunca después del fin del período. */
  dueDate: string;
  /** Ciclo de ajuste (1-based). */
  cycle: number;
  /** Posición dentro del ciclo (1-based) → "Período 2/3". */
  indexInCycle: number;
  /** Largo del ciclo; null si el contrato no se ajusta (→ "Período 7"). */
  cycleLength: number | null;
  /** true en el primer período de un ciclo ≥ 2: ahí rige un precio nuevo. */
  adjustsHere: boolean;
  /**
   * Mes posterior al vencimiento que se cobra porque el inquilino sigue
   * (art. 1218 CCyC): fuera de los ciclos de ajuste (cycle e indexInCycle en 0).
   */
  continuation?: boolean;
}

/** Último día del contrato: inicio + N meses − 1 día (01/03/2026 + 24 → 29/02/2028, año bisiesto). */
export function contractEndDate(startDate: string, durationMonths: number): string {
  return addDays(addMonthsClamped(startDate, durationMonths), -1);
}

function normalizedEvery(every: number | null | undefined): number | null {
  if (!every || !Number.isFinite(every) || every < 1) return null;
  return Math.floor(every);
}

export function buildSchedule(input: ScheduleInput): SchedulePeriod[] {
  const every = normalizedEvery(input.adjustmentEveryMonths);
  const months = Math.max(0, Math.floor(input.durationMonths));
  const windowDays = Math.max(1, Math.floor(input.paymentWindowDays || 1));
  const periods: SchedulePeriod[] = [];
  for (let i = 0; i < months; i++) {
    const start = addMonthsClamped(input.startDate, i);
    const end = addDays(addMonthsClamped(input.startDate, i + 1), -1);
    periods.push({
      index: i + 1,
      start,
      end,
      dueDate: minYmd(addDays(start, windowDays - 1), end),
      cycle: every ? Math.floor(i / every) + 1 : 1,
      indexInCycle: every ? (i % every) + 1 : i + 1,
      cycleLength: every,
      adjustsHere: every ? i > 0 && i % every === 0 : false,
    });
  }
  return periods;
}

/** Tope de meses de continuación que se arman de una vez (10 años): sólo evita un bucle sin fin. */
const MAX_CONTINUATION_PERIODS = 120;

/**
 * Meses posteriores al vencimiento (art. 1218 CCyC: vencido el plazo, si el
 * inquilino sigue, el contrato continúa en las mismas condiciones hasta que
 * alguien lo termine). Siguen la numeración del cronograma (contrato de 24
 * meses → 25, 26…), con el mismo día de inicio y el mismo plazo de pago, desde
 * el primero que sigue al fin hasta el que empieza a más tardar `until`.
 * No forman ciclos de ajuste: se cobran al último precio aplicado.
 */
export function continuationPeriods(input: ScheduleInput, until: string): SchedulePeriod[] {
  const months = Math.max(0, Math.floor(input.durationMonths));
  const windowDays = Math.max(1, Math.floor(input.paymentWindowDays || 1));
  const periods: SchedulePeriod[] = [];
  for (let i = months; periods.length < MAX_CONTINUATION_PERIODS; i++) {
    const start = addMonthsClamped(input.startDate, i);
    if (start > until) break;
    const end = addDays(addMonthsClamped(input.startDate, i + 1), -1);
    periods.push({
      index: i + 1,
      start,
      end,
      dueDate: minYmd(addDays(start, windowDays - 1), end),
      cycle: 0,
      indexInCycle: 0,
      cycleLength: null,
      adjustsHere: false,
      continuation: true,
    });
  }
  return periods;
}

/** Período que contiene la fecha, o null si cae fuera del contrato. */
export function periodAt(schedule: SchedulePeriod[], ymd: string): SchedulePeriod | null {
  for (const p of schedule) {
    if (ymd >= p.start && ymd <= p.end) return p;
  }
  return null;
}

/** Cantidad de ajustes que tiene un contrato (24 meses trimestral → 7). */
export function adjustmentCount(durationMonths: number, every: number | null): number {
  const e = normalizedEvery(every);
  if (!e || durationMonths <= 1) return 0;
  return Math.floor((Math.floor(durationMonths) - 1) / e);
}

export type IndexFrequency = "monthly" | "daily";

export interface AdjustmentWindow {
  /** Número de ajuste (1-based). */
  sequence: number;
  /** Período en el que rige el precio nuevo. */
  periodIndex: number;
  /** Inicio de ese período: desde cuándo se cobra el precio nuevo. */
  effectiveDate: string;
  /**
   * Índices mensuales (IPC, Casa Propia, RIPTE): se compara el nivel del mes
   * `toMonth` contra el de `fromMonth` (claves YYYY-MM-01). La variación
   * incluye los meses `fromMonth+1 … toMonth`.
   */
  fromMonth: string | null;
  toMonth: string | null;
  /** Índices diarios (ICL, UVA, CER): valor del día `toDate` contra el de `fromDate`. */
  fromDate: string | null;
  toDate: string | null;
}

/**
 * Ventanas de cada ajuste. Se encadenan: la base de un ajuste es la llegada
 * del anterior, así el redondeo de cada paso queda incorporado (es lo que pasa
 * en la vida real: el precio redondeado es el que paga el inquilino y el que
 * se vuelve a ajustar).
 *
 * `lagMonths` (sólo índices mensuales) define qué meses se usan para un ajuste
 * que rige desde el mes M:
 *   - 1 → los meses del ciclo que termina (con un ajuste en junio y ciclo
 *         trimestral: marzo, abril y mayo). El dato de mayo se publica a
 *         mediados de junio, así que el ajuste se calcula con unos días de
 *         atraso.
 *   - 2 → el último dato publicado al momento del ajuste (febrero, marzo y
 *         abril): se puede avisar el precio nuevo antes de que empiece junio.
 */
export function buildAdjustmentWindows(
  schedule: SchedulePeriod[],
  startDate: string,
  opts: { frequency: IndexFrequency | null; lagMonths: number },
): AdjustmentWindow[] {
  const lag = Math.max(0, Math.floor(opts.lagMonths));
  const windows: AdjustmentWindow[] = [];
  let prevToMonth = addMonthsToMonth(monthOf(startDate), -lag);
  let prevDate = startDate;
  for (const p of schedule) {
    if (!p.adjustsHere) continue;
    const toMonth = addMonthsToMonth(monthOf(p.start), -lag);
    windows.push({
      sequence: windows.length + 1,
      periodIndex: p.index,
      effectiveDate: p.start,
      fromMonth: opts.frequency === "monthly" ? prevToMonth : null,
      toMonth: opts.frequency === "monthly" ? toMonth : null,
      fromDate: opts.frequency === "daily" ? prevDate : null,
      toDate: opts.frequency === "daily" ? p.start : null,
    });
    prevToMonth = toMonth;
    prevDate = p.start;
  }
  return windows;
}
