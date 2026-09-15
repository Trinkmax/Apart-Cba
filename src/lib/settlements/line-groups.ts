import type { SettlementLine, SettlementStatus } from "@/lib/types/database";
import { round2 } from "@/lib/finance/booking-economics";
import { periodIndex } from "@/lib/finance/prorate";
import { convertToBase } from "./settled-model";

/**
 * Agrupa las líneas de reserva de una liquidación en "porciones": lo que ese
 * documento le rinde al propietario por UNA reserva (`ref_id`).
 *
 * Es la misma forma de agrupar que usa el documento del propietario
 * (statement-model.ts) y el editor (`updateSettlementBookingRow`): todas las
 * líneas con `ref_type='booking'` y el mismo `ref_id` son una fila. Resultados
 * la necesita para conciliar reserva por reserva contra el calendario.
 *
 * Dos marcas que NO son lo mismo (medido sobre Apart CBA, 545 líneas de ingreso):
 *   • `is_manual` = "alguien la editó". 364 líneas lo tienen y 292 de ésas
 *     apuntan a una reserva real. No sirve para saber si la fila es inventada.
 *   • `meta.source = 'manual'` = la fila la creó `addSettlementBookingRow` con
 *     un `ref_id` aleatorio: no hay reserva detrás por id. Las 72 líneas cuyo
 *     `ref_id` no existe en `bookings` tienen esta marca, y ninguna reserva real
 *     la tiene ('manual' no es un `BookingSource`). Es la "porción sintética",
 *     que se empareja con el calendario por unidad y fechas.
 */

export type GroupableLineType = SettlementLine["line_type"];

/** Tipos que son la tarifa del propietario. Todo otro `+` es reintegro (luz, gas, expensas…). */
export const REVENUE_LINE_TYPES: ReadonlySet<GroupableLineType> = new Set<GroupableLineType>([
  "booking_revenue",
  "monthly_rent_fraction",
]);

export interface GroupableLine {
  id: string;
  line_type: GroupableLineType;
  amount: number;
  sign: "+" | "-";
  /** null = la moneda base del documento. */
  currency: string | null;
  unit_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  is_manual: boolean;
  meta: {
    source?: string | null;
    check_in?: string | null;
    check_out?: string | null;
    guest_name?: string | null;
    nights?: number | null;
    prorate_days?: number | null;
    mode?: string | null;
  } | null;
}

export interface GroupableSettlement {
  id: string;
  owner_id: string | null;
  owner_name: string;
  status: SettlementStatus;
  period_year: number;
  period_month: number;
  /** Moneda BASE del documento. */
  currency: string;
  generated_at: string;
  paid_at: string | null;
  net_payable: number;
  exchange_rates: Record<string, number> | null;
  lines: GroupableLine[];
}

export interface BookingLinePiece {
  /** `${settlement_id}:${ref_id}` */
  key: string;
  settlement_id: string;
  owner_id: string | null;
  owner_name: string;
  status: SettlementStatus;
  /** `periodIndex(period_year, period_month)` */
  period: number;
  period_year: number;
  period_month: number;
  doc_currency: string;
  generated_at: string;
  paid_at: string | null;
  ref_id: string;
  unit_id: string | null;
  /** Moneda de la línea de ingreso principal (o la del documento si no hay). */
  currency: string;
  /** Σ de las líneas `+` de ingreso, por moneda NATIVA (sin convertir). */
  revenue: Record<string, number>;
  /** En `currency`, convertidos con `exchange_rates` del documento. */
  reimbursements: number;
  commission: number;
  channel: number;
  expenses: number;
  /** revenue[currency] + reimbursements − commission − channel − expenses */
  net: number;
  /** Alguna línea no se pudo llevar a `currency`: contó 0. */
  missing_rate: boolean;
  /** Ninguna línea con `is_manual`: la fila es tal cual la generó el sistema. */
  all_auto: boolean;
  /** Alguna línea con `meta.source='manual'`: fila creada a mano, sin reserva por id. */
  synthetic: boolean;
  meta_check_in: string | null;
  meta_check_out: string | null;
  guest_name: string | null;
  prorate_days: number | null;
  line_ids: string[];
}

/**
 * true si la línea forma parte de una porción de reserva. Una línea con
 * `ref_type='booking'` y `ref_id` null no se puede agrupar: el documento del
 * propietario la muestra en "Otros cargos", y acá también.
 */
export function isBookingPieceLine(l: { ref_type?: string | null; ref_id?: string | null }): boolean {
  return l.ref_type === "booking" && !!l.ref_id;
}

/**
 * Lleva un importe de la moneda de la línea a la moneda de la porción, pasando
 * por la base del documento (las tasas del documento son "1 X = rate base").
 */
function convertBetween(
  amount: number,
  from: string,
  to: string,
  base: string,
  rates: Record<string, number> | null,
): { value: number; missingRate: boolean } {
  if (from === to) return { value: amount, missingRate: false };
  const inBase = convertToBase(amount, from, base, rates);
  if (inBase.missingRate) return inBase;
  if (to === base) return inBase;
  const rate = Number(rates?.[to] ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return { value: 0, missingRate: true };
  return { value: inBase.value / rate, missingRate: false };
}

export function groupBookingLines(doc: GroupableSettlement): BookingLinePiece[] {
  const groups = new Map<string, GroupableLine[]>();
  for (const l of doc.lines) {
    if (!isBookingPieceLine(l)) continue;
    const arr = groups.get(l.ref_id as string);
    if (arr) arr.push(l);
    else groups.set(l.ref_id as string, [l]);
  }

  const out: BookingLinePiece[] = [];
  for (const [refId, lines] of groups) {
    // La línea de ingreso principal da la moneda, la unidad y el snapshot de
    // fechas/huésped — igual que statement-model.ts.
    const principal =
      lines.find((l) => l.sign === "+" && REVENUE_LINE_TYPES.has(l.line_type)) ??
      lines.find((l) => l.sign === "+") ??
      lines[0];
    const currency = principal.currency ?? doc.currency;
    const metaLine = principal.meta ? principal : lines.find((l) => l.meta) ?? principal;
    const meta = metaLine.meta;

    const revenue: Record<string, number> = {};
    let reimbursements = 0;
    let commission = 0;
    let channel = 0;
    let expenses = 0;
    let missingRate = false;
    let allAuto = true;
    let synthetic = false;

    for (const l of lines) {
      if (l.is_manual) allAuto = false;
      if (l.meta?.source === "manual") synthetic = true;
      const raw = Number(l.amount);
      if (!Number.isFinite(raw)) continue;
      const lineCurrency = l.currency ?? doc.currency;

      // La aritmética la manda `sign` (regla 1 de settled-model.ts): un
      // `booking_revenue` con signo `-` resta como cualquier otro descuento.
      if (l.sign === "+" && REVENUE_LINE_TYPES.has(l.line_type)) {
        // La tarifa se guarda en su moneda nativa: conciliar TREJO2 (reserva
        // en USD, liquidada en ARS) exige ver los 950.000 pesos como pesos,
        // no convertidos a algo que parezca comparable.
        revenue[lineCurrency] = (revenue[lineCurrency] ?? 0) + raw;
        continue;
      }
      const conv = convertBetween(raw, lineCurrency, currency, doc.currency, doc.exchange_rates);
      if (conv.missingRate) missingRate = true;
      if (l.sign === "+") reimbursements += conv.value;
      else if (l.line_type === "commission") commission += conv.value;
      else if (l.line_type === "channel_commission") channel += conv.value;
      else expenses += conv.value;
    }

    for (const c of Object.keys(revenue)) revenue[c] = round2(revenue[c]);
    reimbursements = round2(reimbursements);
    commission = round2(commission);
    channel = round2(channel);
    expenses = round2(expenses);

    out.push({
      key: `${doc.id}:${refId}`,
      settlement_id: doc.id,
      owner_id: doc.owner_id,
      owner_name: doc.owner_name,
      status: doc.status,
      period: periodIndex(doc.period_year, doc.period_month),
      period_year: doc.period_year,
      period_month: doc.period_month,
      doc_currency: doc.currency,
      generated_at: doc.generated_at,
      paid_at: doc.paid_at,
      ref_id: refId,
      unit_id: principal.unit_id ?? lines.find((l) => l.unit_id)?.unit_id ?? null,
      currency,
      revenue,
      reimbursements,
      commission,
      channel,
      expenses,
      net: round2((revenue[currency] ?? 0) + reimbursements - commission - channel - expenses),
      missing_rate: missingRate,
      all_auto: allAuto,
      synthetic,
      meta_check_in: meta?.check_in ?? null,
      meta_check_out: meta?.check_out ?? null,
      guest_name: meta?.guest_name ?? null,
      prorate_days:
        meta?.prorate_days === null || meta?.prorate_days === undefined
          ? null
          : Number(meta.prorate_days),
      line_ids: lines.map((l) => l.id),
    });
  }
  return out;
}

/**
 * Σ |ingreso| en todas las monedas. Sirve para "¿la fila está en cero?": una
 * sintética en 0 (RONDEAU1 "ENTREGA DEPARTAMENTO") no es una liquidación de la
 * reserva, es una nota con forma de fila.
 */
export function pieceRevenueTotal(p: BookingLinePiece): number {
  let s = 0;
  for (const v of Object.values(p.revenue)) s += Math.abs(Number(v) || 0);
  return round2(s);
}
