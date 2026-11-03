/**
 * Qué mes se liquida.
 *
 * Apart CBA generó dos veces el mes en curso en vez del que había cerrado: el
 * 14/09 septiembre y el 03/11 noviembre (64 borradores, "Generar todas"). La
 * pantalla abría siempre en el mes de hoy, y a principios de mes ese casi nunca es
 * el que se quiere liquidar.
 *
 * La línea del 15 sale de cómo trabajan: agosto se generó el 03/09, pero mayo, junio
 * y julio entre el 18 y el 30 de ese mismo mes. En la primera quincena se está
 * cerrando el mes anterior; en la segunda ya se trabaja sobre el actual.
 */

export interface SettlementPeriod {
  year: number;
  month: number;
}

const WORKS_ON_PREVIOUS_MONTH_UNTIL_DAY = 15;

function parseYmd(todayYmd: string): SettlementPeriod & { day: number } {
  const [year, month, day] = todayYmd.split("-").map(Number);
  return { year, month, day };
}

function previousPeriod({ year, month }: SettlementPeriod): SettlementPeriod {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** El último mes completo: el que termina antes de hoy. */
export function lastClosedPeriod(todayYmd: string): SettlementPeriod {
  return previousPeriod(parseYmd(todayYmd));
}

/** En qué mes abre la pantalla si nadie eligió otro. */
export function defaultSettlementPeriod(todayYmd: string): SettlementPeriod {
  const today = parseYmd(todayYmd);
  return today.day <= WORKS_ON_PREVIOUS_MONTH_UNTIL_DAY
    ? previousPeriod(today)
    : { year: today.year, month: today.month };
}

/** El mes de hoy o uno futuro: todavía pueden entrar reservas y cambiar los números. */
export function isPeriodUnfinished(period: SettlementPeriod, todayYmd: string): boolean {
  const today = parseYmd(todayYmd);
  return period.year * 12 + period.month >= today.year * 12 + today.month;
}
