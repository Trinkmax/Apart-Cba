import type { SchedulePeriod } from "@/lib/rentals/schedule";
import { diffDays } from "@/lib/rentals/ymd";
import type { TimelineAdjustment } from "./adjustment-view";

/**
 * Geometría de la línea de tiempo del contrato (pura): un tramo por ciclo de
 * ajuste, con su precio y qué tan firme es, y la posición de "hoy".
 */

export type SegmentCertainty =
  /** Precio inicial del contrato. */
  | "inicial"
  /** Ajuste aplicado: es lo que se cobra. */
  | "aplicado"
  /** Calculado con índices publicados, falta confirmarlo. */
  | "calculado"
  /** Ya rige o está por regir y el índice todavía no salió. */
  | "esperando"
  /** Hay que cargar el monto a mano. */
  | "a_cargar"
  /** Se decidió no aplicar el ajuste: sigue el precio anterior. */
  | "omitido"
  /** Ajuste futuro que todavía no se puede calcular. */
  | "futuro";

export interface TimelineSegment {
  key: string;
  cycle: number;
  start: string;
  /** Inclusivo. */
  end: string;
  fromPeriod: number;
  toPeriod: number;
  months: number;
  amount: number | null;
  certainty: SegmentCertainty;
  /** Ajuste que abre el tramo (null en el primero). */
  adjustment: TimelineAdjustment | null;
  phase: "past" | "current" | "future";
  /** El contrato terminó antes de que empiece (o durante) este tramo. */
  afterTermination: boolean;
  leftPct: number;
  widthPct: number;
}

export interface TimelineModel {
  segments: TimelineSegment[];
  totalDays: number;
  /** Posición de hoy (0-100) o null si hoy cae fuera del contrato. */
  todayPct: number | null;
  todayPhase: "before" | "during" | "after";
  progressPct: number;
  /** Días hasta el último día del contrato (negativo si ya pasó). */
  daysToEnd: number;
  /** Días hasta el inicio (positivo si todavía no empezó). */
  daysToStart: number;
  currentPeriod: SchedulePeriod | null;
  periodsTotal: number;
  /** Posición del fin anticipado, si terminó antes. */
  terminatedPct: number | null;
}

function certaintyOf(adj: TimelineAdjustment | null): SegmentCertainty {
  if (!adj) return "inicial";
  switch (adj.status) {
    case "aplicado":
      return "aplicado";
    case "calculado":
      return "calculado";
    case "omitido":
      return "omitido";
    case "pendiente_indice":
      return "esperando";
    case "pendiente_manual":
      return "a_cargar";
    default:
      return adj.amount != null ? "calculado" : "futuro";
  }
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

export function buildTimelineModel(input: {
  startDate: string;
  endDate: string;
  today: string;
  initialRent: number;
  schedule: SchedulePeriod[];
  adjustments: TimelineAdjustment[];
  terminatedAt?: string | null;
}): TimelineModel {
  const { startDate, endDate, today, schedule } = input;
  const totalDays = Math.max(1, diffDays(startDate, endDate) + 1);
  const pos = (ymd: string) => clampPct((diffDays(startDate, ymd) / totalDays) * 100);
  const adjByPeriod = new Map(input.adjustments.map((a) => [a.periodIndex, a]));
  const terminatedAt = input.terminatedAt && input.terminatedAt < endDate ? input.terminatedAt : null;

  const segments: TimelineSegment[] = [];
  let lastKnown: number | null = input.initialRent;
  for (const p of schedule) {
    const prev = segments[segments.length - 1];
    if (prev && prev.cycle === p.cycle) {
      prev.end = p.end;
      prev.toPeriod = p.index;
      prev.months += 1;
      continue;
    }
    const adj = p.index === 1 ? null : (adjByPeriod.get(p.index) ?? null);
    const certainty = certaintyOf(adj);
    let amount: number | null;
    if (!adj) amount = p.index === 1 ? input.initialRent : lastKnown;
    else if (certainty === "omitido") amount = adj.base ?? lastKnown;
    else amount = adj.amount;
    if (amount != null) lastKnown = amount;
    segments.push({
      key: `c${p.cycle}`,
      cycle: p.cycle,
      start: p.start,
      end: p.end,
      fromPeriod: p.index,
      toPeriod: p.index,
      months: 1,
      amount,
      certainty: p.index === 1 ? "inicial" : adj ? certainty : amount != null ? "calculado" : "futuro",
      adjustment: adj,
      phase: "future",
      afterTermination: false,
      leftPct: 0,
      widthPct: 0,
    });
  }
  for (const s of segments) {
    s.phase = s.end < today ? "past" : s.start > today ? "future" : "current";
    s.afterTermination = terminatedAt != null && s.start > terminatedAt;
    s.leftPct = pos(s.start);
    s.widthPct = clampPct(((diffDays(s.start, s.end) + 1) / totalDays) * 100);
  }

  const todayPhase = today < startDate ? "before" : today > endDate ? "after" : "during";
  const currentPeriod = schedule.find((p) => today >= p.start && today <= p.end) ?? null;
  return {
    segments,
    totalDays,
    todayPct: todayPhase === "during" ? clampPct(((diffDays(startDate, today) + 0.5) / totalDays) * 100) : null,
    todayPhase,
    progressPct: todayPhase === "before" ? 0 : todayPhase === "after" ? 100 : pos(today),
    daysToEnd: diffDays(today, endDate),
    daysToStart: diffDays(today, startDate),
    currentPeriod,
    periodsTotal: schedule.length,
    terminatedPct: terminatedAt ? pos(terminatedAt) : null,
  };
}
