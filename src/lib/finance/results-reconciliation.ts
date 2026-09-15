import type { BookingSource, BookingStatus, SettlementStatus } from "@/lib/types/database";
import {
  computeBookingEconomics,
  channelCommissionPctFor,
  resolveCommissionPct,
  round2,
  type CommissionBase,
} from "./booking-economics";
import {
  isRealYmd,
  monthBounds,
  monthOverlapNights,
  nightsBetween,
  periodFromIndex,
  periodIndex,
  periodOf,
} from "./prorate";
import { addDaysYmd, DEFAULT_ORG_TIMEZONE, ymdInTz } from "@/lib/dates";
import {
  groupBookingLines,
  isBookingPieceLine,
  pieceRevenueTotal,
  type BookingLinePiece,
  type GroupableSettlement,
} from "@/lib/settlements/line-groups";
import {
  buildSettledResults,
  convertToBase,
  type SettledResults,
  type SettledSettlementInput,
} from "@/lib/settlements/settled-model";
import { BOOKING_SOURCE_META } from "@/lib/constants";
import {
  ISSUE_META,
  ISSUE_TEXT,
  HIGH_RATE_DIFF_PCT,
  LONG_STAY_NIGHTS,
  MAX_SETTLEMENT_WINDOW_MONTHS,
  MIN_ARS_PER_NIGHT,
  OTA_SOURCES,
  RENT_TOLERANCE,
  REVIEW_EXTRA_META,
  REVIEW_GROUP_META,
  REVIEW_WHERE_ORDER,
  SYNTHETIC_MIN_OVERLAP,
  TOL,
  monthNameLower,
  shortPeriodLabel,
  type AggregateView,
  type Coverage,
  type InfoFlag,
  type IssueCode,
  type OrphanReason,
  type Outcome,
  type ResultsMode,
  type ReviewGroup,
  type ReviewWhere,
  type RowLevel,
} from "./results-issues";

export type {
  AggregateView,
  Coverage,
  InfoFlag,
  IssueCode,
  OrphanReason,
  Outcome,
  ResultsMode,
  ReviewGroup,
  ReviewWhere,
  RowLevel,
} from "./results-issues";
export type { BookingLinePiece, GroupableSettlement, GroupableLine } from "@/lib/settlements/line-groups";

/**
 * Conciliación del mes: el calendario contra la liquidación, reserva por reserva.
 *
 * El pedido del dueño: "Resultados no puede tomar el ingreso de la liquidación".
 * Los operadores editan la fila de la liquidación: el huésped paga 80.000 y al
 * propietario se le rinde sobre 70.000. Lo que pagó el huésped (G) está en
 * `bookings` — Caja lo confirma en 82 de 82 reservas con cobro — y lo que se le
 * rinde al propietario (R) está en su liquidación. La diferencia (D) es margen
 * de la administración que hasta ahora no se veía: −$9,2M en temporario de
 * junio a agosto 2026 en Apart CBA.
 *
 * Pero la misma brecha también esconde errores de carga (VEL727 con dos dueños
 * al 100%, DIVA con dólares cargados como pesos, TERRA en $0 en el calendario,
 * SARA liquidada dos veces). Por eso cada reserva cae en UN balde:
 *   • conciliada   (coincide / diferencia): entra en el margen;
 *   • sin liquidar (estimada): se estima con "≈", sin diferencia;
 *   • sin conciliar (dato roto o liquidado de más): va a "Para revisar" y no
 *     entra en ningún KPI de negocio.
 *
 * Todo es puro: results.ts trae las filas y llama a `reconcileMonth`.
 */

export const ACTIVE_BOOKING_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  "pendiente",
  "confirmada",
  "check_in",
  "check_out",
]);

export type ChannelCommissions = Partial<Record<BookingSource, number>>;

// ── Entrada ──────────────────────────────────────────────────────────────────

export interface ResultBookingInput {
  id: string;
  unit_id: string;
  lease_group_id: string | null;
  guest_name: string | null;
  source: BookingSource;
  status: BookingStatus;
  mode: "temporario" | "mensual";
  check_in_date: string;
  check_out_date: string;
  currency: string | null;
  total_amount: number;
  paid_amount: number;
  cleaning_fee: number | null;
  commission_pct: number | null;
  channel_commission_pct: number | null;
  monthly_rent: number | null;
  monthly_expenses: number | null;
  updated_at: string;
}

export interface UnitOwnerInput {
  owner_id: string;
  owner_name: string;
  /** null = 100, igual que la generación de liquidaciones. */
  ownership_pct: number | null;
  commission_pct_override?: number | null;
}

export interface UnitInput {
  id: string;
  code: string;
  name: string;
  owners: UnitOwnerInput[];
  default_commission_pct?: number | null;
}

export interface ExtraChargeInput {
  ref_id: string;
  amount: number;
  currency: string;
  billable_to: string | null;
  description: string | null;
  /** timestamptz del movimiento en Caja. Un mensual lo imputa al mes del movimiento. */
  occurred_at?: string | null;
}

export interface ReconcileOrgInput {
  base_currency: string;
  commission_base: CommissionBase;
  channel_commissions: ChannelCommissions;
  /** Cascada de comisión de administración (migración 059). */
  commission_by_source?: ChannelCommissions | null;
  default_commission_pct?: number | null;
  /** Zona horaria de la org (`organizations.timezone`). Default: Córdoba. */
  timezone?: string | null;
}

export interface RefLookupInput {
  id: string;
  status: BookingStatus;
  is_block: boolean;
  mode: string;
  /** Para detectar filas de liquidación reusadas para otra estadía (`isDeadRefPiece`). */
  check_in_date?: string | null;
  check_out_date: string;
}

export interface ReconcileInput {
  year: number;
  month: number;
  mode: ResultsMode;
  org: ReconcileOrgInput;
  /** Q1 ∪ Q3 (tramos de los contratos mensuales que tocan el mes). */
  bookings: ResultBookingInput[];
  /** Q5a: candidatas para las filas sintéticas. */
  candidates: ResultBookingInput[];
  /** Q5b: refs no sintéticas del período sin fila en el mes. */
  refLookups: RefLookupInput[];
  /** Q2 */
  units: UnitInput[];
  /** Q4a ∪ Q4b, sin anuladas. */
  settlements: GroupableSettlement[];
  /** Q6 */
  extraCharges: ExtraChargeInput[];
  /** Q7, como `periodIndex`. */
  firstSettlementPeriod: number | null;
}

// ── Salida ───────────────────────────────────────────────────────────────────

export interface RowSettled {
  /** G_cov */
  guest_total: number;
  /** P_cov */
  channel: number;
  /** R */
  owner_rate: number;
  owner_rate_other: { currency: string; amount: number } | null;
  /** P_liq */
  settlement_channel: number;
  reimbursements: number;
  commission: number;
  expenses: number;
  owner_net: number;
  rate_diff: number | null;
  rate_diff_pct: number | null;
}

export interface RowEstimated {
  guest_total: number;
  channel: number;
  commission: number;
  expenses: number;
  owner_net: number;
}

export interface RowIssue {
  code: IssueCode;
  group: ReviewGroup;
  detail: string;
  at_stake: number;
  at_stake_currency: string;
  href: string;
  cta: string;
}

export interface PieceSummary {
  /** `${settlement_id}:${ref_id}` */
  key: string;
  settlement_id: string;
  owner_name: string;
  period_label: string;
  status: SettlementStatus;
  currency: string;
  /** Tarifa del propietario de esta porción, en `currency`. */
  revenue: number;
  commission: number;
  /** Plataforma liquidada en esta porción. */
  channel: number;
  /** Limpieza y gastos menos reintegros (E − Reint). */
  expenses: number;
  net: number;
  matched_by: "ref" | "fechas";
  counted: boolean;
  href: string;
}

export interface RowOwnerSplit {
  owner_id: string | null;
  owner_name: string;
  share_pct: number;
  guest_total: number;
  channel: number;
  has_piece: boolean;
  owner_rate: number | null;
  rate_diff: number | null;
  commission: number;
  /** E − Reint si tiene porción; limpieza/expensas estimadas si no. */
  expenses: number;
  owner_net: number;
  settlement_id: string | null;
}

export interface ReconciledRow {
  /** booking_id | `${lease_group_id ?? id}:${y}-${m}` */
  key: string;
  booking_ids: string[];
  primary_booking_id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  guest_name: string | null;
  source: BookingSource;
  mode: "temporario" | "mensual";
  check_in_date: string;
  check_out_date: string;
  nights: number;
  prorate: { nights: number; of: number } | null;
  currency: string;
  guest_total: number;
  paid: number;
  pending: number;
  channel_commission: number;
  channel_pct: number | null;
  /** % de administración resuelto por la cascada (ponderado entre co-dueños). */
  commission_pct: number;
  coverage: Coverage;
  covered_pct: number;
  outcome: Outcome;
  level: RowLevel;
  settled: RowSettled | null;
  estimated: RowEstimated | null;
  parts: { settled: number; estimated: number; unreconciled: number };
  issues: RowIssue[];
  flags: InfoFlag[];
  pieces: PieceSummary[];
  periods: string[];
  primary_settlement_id: string | null;
  owners: RowOwnerSplit[];
  extra_charges: number;
  extra_charge_items: ExtraChargeInput[];
  excluded_from_totals: boolean;
}

export interface OrphanRow {
  key: string;
  settlement_id: string;
  settlement_status: SettlementStatus;
  owner_id: string | null;
  owner_name: string;
  unit_id: string | null;
  unit_code: string | null;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  currency: string;
  revenue: number;
  net: number;
  reason: OrphanReason;
  booking_id: string | null;
  candidate_booking_ids: string[];
}

/** Puente de un propietario: por qué la liquidación del mes no es "la suma de las reservas del mes". */
export interface OwnerBridge {
  owner_id: string | null;
  owner_name: string;
  /** Moneda base de los documentos del período (y,m). */
  currency: string;
  settlement_ids: string[];
  statuses: SettlementStatus[];
  /** Cabecera del documento (cache). */
  net_payable: number;
  paid: boolean;
  month_rows_net_all_periods: number;
  month_rows_net_other_periods: number;
  other_month_rows_net: number;
  orphans_net: number;
  other_charges_net: number;
  /** Recalculado desde las líneas. */
  lines_net: number;
  missing_rate: boolean;
}

export interface FlowAmounts {
  bookings: number;
  guest_total: number;
  channel: number;
  rate_diff: number;
  commission: number;
  expenses_net: number;
  owner_net: number;
}

export interface EstimatedAmounts {
  bookings: number;
  guest_total: number;
  channel: number;
  commission: number;
  expenses: number;
  owner_net: number;
}

export interface AggregateRow {
  key: string;
  label: string;
  sublabel: string | null;
  currency: string;
  bookings: number;
  bookings_review: number;
  bookings_estimated: number;
  guest_total: number;
  settled: FlowAmounts;
  estimated: EstimatedAmounts;
  overpaid_excess: number;
  other_charges_net: number | null;
  channel_pct: number | null;
  bridge: OwnerBridge | null;
  unit_id?: string;
  owner_id?: string | null;
  source?: BookingSource;
}

export interface ResultTotals {
  currency: string;
  bookings: number;
  guest_total: number;
  paid: number;
  pending: number;
  /** Σ "Paga el huésped" por modo. */
  by_mode: { temporario: number; mensual: number };
  parts: { settled: number; estimated: number; unreconciled: number };
  settled: FlowAmounts;
  estimated: EstimatedAmounts;
  admin_income: number;
  rate_diff_pct: number | null;
  /** settled.bookings / bookings (0–1). */
  settled_share: number;
  overpaid: { bookings: number; excess: number };
  unreconciled_bookings: number;
  extra_charges: number;
  excluded_bookings: number;
}

export interface ReviewItem {
  id: ReviewGroup | "sin_reserva" | "saldo_huesped";
  where: ReviewWhere;
  label: string;
  count: number;
  at_stake: Array<{ currency: string; amount: number }>;
  /** "aviso:<group>" | "flag:saldo" | null */
  filter: string | null;
  /**
   * Sólo comisiones trae href absoluto. `sin_reserva` va en null: el link a la
   * pestaña de huérfanas necesita año/mes/modo, así que lo arma la UI con
   * `resultsHref(..., { tab: "huerfanas" })`.
   */
  href: string | null;
}

export interface MonthClose {
  currency: string;
  owners_with_bookings: number;
  settlements: number;
  settlements_paid: number;
  net_payable: number;
  net_paid: number;
  net_pending: number;
  bookings_not_settled: number;
  bookings_missing_price: number;
  extra_charges: number;
}

export interface ReconciledMonth {
  rows: ReconciledRow[];
  totals: ResultTotals[];
  by_unit: AggregateRow[];
  by_owner: AggregateRow[];
  by_channel: AggregateRow[];
  orphans: OrphanRow[];
  bridges: OwnerBridge[];
  review: ReviewItem[];
  close: MonthClose[];
  missing_price_count: number;
  channels_without_pct: BookingSource[];
}

// ── Borradores de fila ───────────────────────────────────────────────────────

export interface DraftTramo {
  booking: ResultBookingInput;
  /** n_t: noches dentro del mes. */
  nights_in_month: number;
  /** N_t: noches del tramo. */
  nights_total: number;
  /** Temporario: siempre true. */
  consistent: boolean;
  /** G_t */
  guest_total: number;
  /** Aporte a "Cobrado". */
  paid: number;
}

export interface AttachedPiece {
  piece: BookingLinePiece;
  matched_by: "ref" | "fechas";
  counted: boolean;
}

export interface DraftRow {
  key: string;
  mode: "temporario" | "mensual";
  primary: ResultBookingInput;
  /** Mensual: todos los tramos del contrato (Q1 ∪ Q3). Temporario: [la reserva]. */
  group_bookings: ResultBookingInput[];
  /** Tramos que tocan el mes. */
  tramos: DraftTramo[];
  unit_id: string;
  currency: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  prorate: { nights: number; of: number } | null;
  guest_total: number;
  cleaning: number;
  channel_pct: number | null;
  channel_commission: number;
  paid: number;
  pending: number;
  pieces: AttachedPiece[];
}

function groupKeyOf(b: Pick<ResultBookingInput, "id" | "lease_group_id">): string {
  return b.lease_group_id ?? b.id;
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * % de plataforma de una temporaria. `null` = OTA sin % en la reserva ni en la
 * org: ahí la diferencia puede ser lo que se lleva Airbnb, así que no se puede
 * leer como margen (aviso `canal_sin_comision`). Un canal propio sin % es 0.
 */
function resolveChannelPct(b: ResultBookingInput, org: ReconcileOrgInput): number | null {
  if (b.channel_commission_pct !== null && b.channel_commission_pct !== undefined) {
    const n = Number(b.channel_commission_pct);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  const configured = org.channel_commissions?.[b.source];
  if (configured !== null && configured !== undefined) {
    return channelCommissionPctFor(org.channel_commissions, b.source);
  }
  return OTA_SOURCES.has(b.source) ? null : 0;
}

/**
 * Un tramo mensual es consistente si su total está a ≤4% de renta÷30×noches
 * (la base de la migración 054). Si lo es, "Paga el huésped" sale de la renta
 * prorrateada por días del mes, igual que la línea de la liquidación.
 */
function isConsistentTramo(rent: number, total: number, nightsTotal: number): boolean {
  return rent > 0 && nightsTotal > 0 && Math.abs(total - (rent / 30) * nightsTotal) <= RENT_TOLERANCE * total;
}

/**
 * Lo que un tramo mensual suma en la MISMA base que la liquidación: renta ÷
 * días de cada mes × noches de ese mes (consistente), o el total (si no).
 * `contrato_incompleto` compara contra esto y no contra `total_amount` (base 30):
 * un contrato que cubre un febrero completo da 840.000 en el calendario y
 * 900.000 bien liquidados, sin ningún error.
 */
function tramoLiquidationBase(b: ResultBookingInput): number {
  const N = nightsBetween(b.check_in_date, b.check_out_date);
  const rent = num(b.monthly_rent);
  const total = num(b.total_amount);
  if (!isConsistentTramo(rent, total, N)) return total;
  let sum = 0;
  const first = periodOf(b.check_in_date).index;
  const last = periodOf(b.check_out_date).index;
  for (let idx = first; idx <= last; idx++) {
    const { year, month } = periodFromIndex(idx);
    const n = monthOverlapNights(b.check_in_date, b.check_out_date, year, month);
    if (n > 0) sum += (rent / monthBounds(year, month).days) * n;
  }
  return round2(sum);
}

/** Noches que comparten [aCi, aCo) y [bCi, bCo). */
function overlapNights(aCi: string, aCo: string, bCi: string, bCo: string): number {
  return nightsBetween(aCi > bCi ? aCi : bCi, aCo < bCo ? aCo : bCo);
}

/**
 * Fila de liquidación REUSADA para otra estadía: no es sintética (tiene el
 * `ref_id` de una reserva real), alguien la editó y sus fechas no comparten ni
 * una noche con esa reserva. `updateSettlementBookingRow` deja reescribir
 * `meta.check_in/check_out` sin tocar el `ref_id`, y los operadores usan la
 * fila de la estadía anterior para liquidar la siguiente: CAS1083 julio tiene
 * el `ref_id` de 19/06→19/07 y fechas 19/07→19/08 por 900.000. Por ref le
 * acreditaba la plata a la estadía equivocada, corrida un mes (+2.160.000 de
 * "diferencia" falsa en agosto). Se trata como sintética: se empareja por
 * unidad y fechas, que son las que imprime el documento del propietario.
 *
 * Sólo filas editadas (`!all_auto`): una automática con la reserva movida
 * después de generar es `liquidacion_vieja`, no una fila de otra estadía.
 */
export function isDeadRefPiece(
  piece: BookingLinePiece,
  ref: { check_in_date: string; check_out_date: string } | null | undefined,
): boolean {
  if (piece.synthetic || piece.all_auto || !ref) return false;
  const ci = piece.meta_check_in;
  const co = piece.meta_check_out;
  if (!isRealYmd(ci) || !isRealYmd(co) || ci >= co) return false;
  if (!isRealYmd(ref.check_in_date) || !isRealYmd(ref.check_out_date)) return false;
  return overlapNights(ci, co, ref.check_in_date, ref.check_out_date) === 0;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const m = new Map<string, T>();
  for (const it of items) if (!m.has(it.id)) m.set(it.id, it);
  return [...m.values()];
}

/**
 * Filas del mes antes de mirar la liquidación: G, P y Cobrado.
 *   • Temporario: una fila por reserva con check-out en el mes.
 *   • Mensual: una fila por contrato (`lease_group_id ?? id`) que suma los
 *     tramos con noches en el mes. Los contratos se parten en tramos por
 *     extensiones y cambios de precio; mirar un tramo suelto da diferencias
 *     falsas (BSAS1: 31/07→01/08 por $1.100.000 y 01/08→31/08 por $70.968).
 */
export function buildDraftRows(
  input: Pick<ReconcileInput, "year" | "month" | "org" | "bookings">,
): DraftRow[] {
  const { year: y, month: m, org } = input;
  const P = periodIndex(y, m);
  const { days } = monthBounds(y, m);
  const active = dedupeById(input.bookings).filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status));
  const drafts: DraftRow[] = [];
  const groups = new Map<string, ResultBookingInput[]>();

  for (const b of active) {
    if (b.mode === "mensual") {
      const k = groupKeyOf(b);
      const arr = groups.get(k);
      if (arr) arr.push(b);
      else groups.set(k, [b]);
      continue;
    }
    if (periodOf(b.check_out_date).index !== P) continue;
    const G = round2(num(b.total_amount));
    const pct = resolveChannelPct(b, org);
    const paid = round2(num(b.paid_amount));
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    drafts.push({
      key: b.id,
      mode: "temporario",
      primary: b,
      group_bookings: [b],
      tramos: [
        { booking: b, nights_in_month: nights, nights_total: nights, consistent: true, guest_total: G, paid },
      ],
      unit_id: b.unit_id,
      currency: b.currency ?? org.base_currency,
      check_in_date: b.check_in_date,
      check_out_date: b.check_out_date,
      nights,
      prorate: null,
      guest_total: G,
      cleaning: round2(num(b.cleaning_fee)),
      channel_pct: pct,
      // Mismo redondeo que computeBookingEconomics y la liquidación.
      channel_commission: round2(G * ((pct ?? 0) / 100)),
      paid,
      pending: round2(Math.max(0, G - paid)),
      pieces: [],
    });
  }

  for (const [gid, all] of groups) {
    const tramos: DraftTramo[] = [];
    for (const t of all) {
      const n = monthOverlapNights(t.check_in_date, t.check_out_date, y, m);
      if (n <= 0) continue;
      const N = nightsBetween(t.check_in_date, t.check_out_date);
      const rent = num(t.monthly_rent);
      const total = num(t.total_amount);
      // G sale de la renta cuando el tramo es consistente y del total cuando no.
      // Con total÷noches, un tramo consistente de 31 noches da 3,3% de
      // diferencia falsa contra la línea de la liquidación (renta÷días del mes).
      // Con la renta a secas, BSAS1 (renta 1,00) o ORO (renta 1.039.000 sobre
      // 214 noches) darían cualquier cosa.
      const consistent = isConsistentTramo(rent, total, N);
      const G_t = consistent ? round2((rent / days) * n) : N > 0 ? round2((total * n) / N) : 0;
      // Cobrado prorrateado por noches con tope en G_t: ORO cobró 3.117.000 del
      // contrato entero; en septiembre no puede figurar cobrado más que lo del mes.
      const paid_t = N > 0 ? Math.min(G_t, (num(t.paid_amount) * n) / N) : 0;
      tramos.push({ booking: t, nights_in_month: n, nights_total: N, consistent, guest_total: G_t, paid: paid_t });
    }
    if (tramos.length === 0) continue;
    tramos.sort(
      (a, b) =>
        b.nights_in_month - a.nights_in_month || a.booking.check_in_date.localeCompare(b.booking.check_in_date),
    );
    const primary = tramos[0].booking;
    const G = round2(tramos.reduce((a, t) => a + t.guest_total, 0));
    const paid = round2(tramos.reduce((a, t) => a + t.paid, 0));
    const nights = tramos.reduce((a, t) => a + t.nights_in_month, 0);
    drafts.push({
      key: `${gid}:${y}-${m}`,
      mode: "mensual",
      primary,
      group_bookings: all,
      tramos,
      unit_id: primary.unit_id,
      currency: primary.currency ?? org.base_currency,
      check_in_date: all.reduce((a, t) => (t.check_in_date < a ? t.check_in_date : a), all[0].check_in_date),
      check_out_date: all.reduce((a, t) => (t.check_out_date > a ? t.check_out_date : a), all[0].check_out_date),
      nights,
      prorate: { nights, of: days },
      guest_total: G,
      cleaning: 0,
      // Las OTAs no venden contratos mensuales.
      channel_pct: 0,
      channel_commission: 0,
      paid,
      pending: round2(Math.max(0, G - paid)),
      pieces: [],
    });
  }
  return drafts;
}

/**
 * Ventana de liquidaciones que hay que traer para conciliar el mes (Q4).
 * Hasta (y,m)+1: una reserva que sale el 31 a veces se liquida al mes siguiente.
 * Desde el mes anterior al check-in: el patrón de "fila manual del mes anterior
 * con fechas corridas" (SARA, FRUC, BSAS2). Una estadía larga se liquida desde
 * su mes de check-in (CAS1152: mayo, junio y julio con filas manuales). Nunca
 * antes de la primera liquidación de la org ni más de
 * MAX_SETTLEMENT_WINDOW_MONTHS meses atrás (sin ese tope, un contrato mensual
 * largo arrastraba la historia entera a cada vista).
 */
export function settlementWindow(
  input: Pick<ReconcileInput, "year" | "month" | "org" | "bookings" | "firstSettlementPeriod">,
): { from: number; to: number } {
  const P = periodIndex(input.year, input.month);
  const to = P + 1;
  let from = P - 1;
  for (const d of buildDraftRows(input)) {
    const ci = periodOf(d.check_in_date).index;
    if (d.mode === "mensual") from = Math.min(from, ci);
    else from = Math.min(from, d.nights >= LONG_STAY_NIGHTS ? ci : ci - 1);
  }
  from = Math.max(from, P - MAX_SETTLEMENT_WINDOW_MONTHS);
  if (input.firstSettlementPeriod !== null) from = Math.max(from, input.firstSettlementPeriod);
  return { from: Math.min(from, to), to };
}

/**
 * Qué más hay que leer después de traer reservas y liquidaciones (ronda 3):
 *   • `refIds`: refs no sintéticas del período sin fila en el mes (Q5b), para
 *     saber si la reserva es de otro mes, está cancelada o ya no existe;
 *   • `synthetic`: unidad y fechas de cada fila sintética válida de la ventana
 *     (Q5a trae las reservas activas de esas unidades que solapan esas fechas).
 *
 * Filas reusadas para otra estadía (`isDeadRefPiece`): también suman su rango a
 * Q5a, para que la asignación por fechas vea TODAS las candidatas y dé la misma
 * ganadora desde cualquier mes. Si la reserva del `ref_id` no está cargada, va
 * a Q5b (con su check-in) cuando la fila es del mes o sus fechas tocan una
 * reserva cargada de esa unidad — única forma de que termine en una fila de
 * esta vista. Fechas que no existen ('2026-02-30') nunca llegan a PostgREST.
 */
export function collectLookups(
  input: Pick<ReconcileInput, "year" | "month" | "org" | "bookings" | "settlements">,
): { refIds: string[]; synthetic: Array<{ unit_id: string; check_in: string; check_out: string }> } {
  const P = periodIndex(input.year, input.month);
  const drafts = buildDraftRows(input);
  const withRow = new Set<string>();
  for (const d of drafts) {
    for (const b of d.group_bookings) withRow.add(b.id);
  }
  const loaded = new Map<string, ResultBookingInput>();
  const loadedByUnit = new Map<string, ResultBookingInput[]>();
  for (const b of dedupeById(input.bookings)) {
    loaded.set(b.id, b);
    const arr = loadedByUnit.get(b.unit_id);
    if (arr) arr.push(b);
    else loadedByUnit.set(b.unit_id, [b]);
  }
  const refIds = new Set<string>();
  const synthetic: Array<{ unit_id: string; check_in: string; check_out: string }> = [];
  for (const doc of dedupeById(input.settlements)) {
    for (const p of groupBookingLines(doc)) {
      const ci = p.meta_check_in;
      const co = p.meta_check_out;
      const range =
        p.unit_id && isRealYmd(ci) && isRealYmd(co) && ci < co
          ? { unit_id: p.unit_id, check_in: ci, check_out: co }
          : null;
      if (p.synthetic) {
        if (range) synthetic.push(range);
        continue;
      }
      if (range && !p.all_auto) {
        const ref = loaded.get(p.ref_id);
        if (ref) {
          if (isDeadRefPiece(p, ref)) synthetic.push(range);
        } else if (
          p.period === P ||
          (loadedByUnit.get(range.unit_id) ?? []).some(
            (b) => overlapNights(b.check_in_date, b.check_out_date, range.check_in, range.check_out) > 0,
          )
        ) {
          synthetic.push(range);
          refIds.add(p.ref_id);
        }
      }
      if (p.period !== P) continue;
      if (withRow.has(p.ref_id)) continue;
      refIds.add(p.ref_id);
    }
  }
  return { refIds: [...refIds], synthetic };
}

// ── Pasada 2: filas sintéticas ───────────────────────────────────────────────

export type SyntheticAssignment =
  | { kind: "booking"; booking_id: string; overlap_nights: number; period: number }
  | { kind: "orphan"; reason: "sin_reserva" | "fechas_invalidas" | "ambigua"; candidate_booking_ids: string[] };

/**
 * A qué reserva pertenece una fila creada a mano (`meta.source='manual'`).
 *
 * No hay id que la una: se busca en la misma unidad la reserva activa que más
 * noches comparte con las fechas de la fila, de CUALQUIER mes y modo. La
 * asignación es global: la misma fila da la misma ganadora mirada desde
 * cualquier mes, así cada porción suma en una sola vista mensual.
 *
 * `period` es el mes en el que la ganadora se muestra: el del check-out si es
 * temporaria; el de la propia fila si es mensual y el contrato tiene noches
 * ese mes. Si no las tiene, -1: no hay vista donde sumarla sin inventar un
 * mes, y en su propio período va al puente como "reservas de otros meses".
 */
export function assignSyntheticPiece(
  piece: BookingLinePiece,
  candidates: ResultBookingInput[],
): SyntheticAssignment {
  const ci = piece.meta_check_in;
  const co = piece.meta_check_out;
  // PEREDO 30/07 → 02/07: con las fechas invertidas no hay solape que medir.
  // Una fecha que no existe ('2026-02-30') tampoco.
  if (!isRealYmd(ci) || !isRealYmd(co) || ci >= co) {
    return { kind: "orphan", reason: "fechas_invalidas", candidate_booking_ids: [] };
  }
  const pieceNights = nightsBetween(ci, co);
  const scored: Array<{ b: ResultBookingInput; ov: number; dist: number }> = [];
  for (const b of dedupeById(candidates)) {
    if (!piece.unit_id || b.unit_id !== piece.unit_id) continue;
    if (!ACTIVE_BOOKING_STATUSES.has(b.status)) continue;
    const start = b.check_in_date > ci ? b.check_in_date : ci;
    const end = b.check_out_date < co ? b.check_out_date : co;
    const ov = nightsBetween(start, end);
    if (ov <= 0) continue;
    if (ov / pieceNights < SYNTHETIC_MIN_OVERLAP) continue;
    // |b.check_out − meta_co| en días (nightsBetween nunca es negativo: uno de
    // los dos términos es 0).
    const dist = nightsBetween(b.check_out_date, co) + nightsBetween(co, b.check_out_date);
    scored.push({ b, ov, dist });
  }
  if (scored.length === 0) {
    return { kind: "orphan", reason: "sin_reserva", candidate_booking_ids: [] };
  }
  scored.sort((a, b) => b.ov - a.ov || a.dist - b.dist);
  const best = scored[0];
  const tied = scored.filter((s) => s.ov === best.ov && s.dist === best.dist);
  // Dos tramos del MISMO contrato empatados son la misma fila de Resultados:
  // eso no es ambigüedad.
  const tiedRows = new Set(tied.map((s) => (s.b.mode === "mensual" ? groupKeyOf(s.b) : s.b.id)));
  if (tiedRows.size > 1) {
    return { kind: "orphan", reason: "ambigua", candidate_booking_ids: tied.map((s) => s.b.id) };
  }

  let period: number;
  if (best.b.mode === "mensual") {
    const gid = groupKeyOf(best.b);
    const touches = candidates.some(
      (t) =>
        t.mode === "mensual" &&
        groupKeyOf(t) === gid &&
        ACTIVE_BOOKING_STATUSES.has(t.status) &&
        monthOverlapNights(t.check_in_date, t.check_out_date, piece.period_year, piece.period_month) > 0,
    );
    period = touches ? piece.period : -1;
  } else {
    period = periodOf(best.b.check_out_date).index;
  }
  return { kind: "booking", booking_id: best.b.id, overlap_nights: best.ov, period };
}

// ── Emparejamiento ───────────────────────────────────────────────────────────

export interface AttachContext {
  refLookups?: RefLookupInput[];
  /** Pool de reservas conocidas (Q1 ∪ Q3 ∪ Q5a): existencia/estado de refs y grupo de la ganadora. */
  bookings?: ResultBookingInput[];
  units?: UnitInput[];
}

function orphanOf(
  piece: BookingLinePiece,
  reason: OrphanReason,
  bookingId: string | null,
  candidates: string[],
  unitCode: string | null,
): OrphanRow {
  return {
    key: piece.key,
    settlement_id: piece.settlement_id,
    settlement_status: piece.status,
    owner_id: piece.owner_id,
    owner_name: piece.owner_name,
    unit_id: piece.unit_id,
    unit_code: unitCode,
    guest_name: piece.guest_name,
    check_in: piece.meta_check_in,
    check_out: piece.meta_check_out,
    currency: piece.currency,
    revenue: round2(piece.revenue[piece.currency] ?? 0),
    net: piece.net,
    reason,
    booking_id: bookingId,
    candidate_booking_ids: candidates,
  };
}

/**
 * Cuelga cada porción de su fila (pasada 1 por `ref_id`, pasada 2 por fechas)
 * y clasifica las porciones del período (y,m) que no quedan en ninguna fila.
 *
 * Garantía para el puente: toda porción del período (y,m) termina en exactamente
 * uno de tres lugares — una fila del mes, `orphans` u `otherMonthPieceKeys`.
 */
export function attachPieces(
  drafts: DraftRow[],
  pieces: BookingLinePiece[],
  assignments: Map<string, SyntheticAssignment>,
  y: number,
  m: number,
  ctx: AttachContext = {},
): { attached: DraftRow[]; orphans: OrphanRow[]; otherMonthPieceKeys: Set<string> } {
  const P = periodIndex(y, m);
  const attached = drafts.map((d) => ({ ...d, pieces: [...d.pieces] }));
  const rowByBooking = new Map<string, DraftRow>();
  const rowByGroup = new Map<string, DraftRow>();
  for (const d of attached) {
    for (const b of d.group_bookings) rowByBooking.set(b.id, d);
    if (d.mode === "mensual") rowByGroup.set(groupKeyOf(d.primary), d);
  }
  const unitCode = new Map((ctx.units ?? []).map((u) => [u.id, u.code]));
  const known = new Map<string, { status: BookingStatus; is_block: boolean; lease_group_id: string | null; mode: string }>();
  for (const b of ctx.bookings ?? []) {
    known.set(b.id, { status: b.status, is_block: false, lease_group_id: b.lease_group_id, mode: b.mode });
  }
  for (const d of drafts) {
    for (const b of d.group_bookings) {
      known.set(b.id, { status: b.status, is_block: false, lease_group_id: b.lease_group_id, mode: b.mode });
    }
  }
  for (const r of ctx.refLookups ?? []) {
    const prev = known.get(r.id);
    known.set(r.id, { status: r.status, is_block: r.is_block, lease_group_id: prev?.lease_group_id ?? null, mode: r.mode });
  }

  const orphans: OrphanRow[] = [];
  const otherMonth = new Set<string>();

  for (const piece of pieces) {
    const code = piece.unit_id ? unitCode.get(piece.unit_id) ?? null : null;

    if (!piece.synthetic) {
      const row = rowByBooking.get(piece.ref_id);
      // Temporaria: de cualquier período (una reserva que sale el 31 se liquida
      // a veces en el mes siguiente). Mensual: sólo la del período, porque el
      // contrato tiene una fila por mes y cada mes se liquida lo suyo.
      if (row && (row.mode === "temporario" || piece.period === P)) {
        row.pieces.push({ piece, matched_by: "ref", counted: true });
        continue;
      }
      if (piece.period !== P) continue;
      const k = known.get(piece.ref_id);
      if (!k) orphans.push(orphanOf(piece, "reserva_borrada", null, [], code));
      else if (k.is_block || !ACTIVE_BOOKING_STATUSES.has(k.status)) {
        orphans.push(orphanOf(piece, "reserva_cancelada", piece.ref_id, [], code));
      } else otherMonth.add(piece.key);
      continue;
    }

    const a = assignments.get(piece.key);
    // Una sintética en $0 no liquida nada (RONDEAU1 "ENTREGA DEPARTAMENTO"
    // solapa 6 reservas): se muestra en la ganadora pero no la da por liquidada.
    const counted = pieceRevenueTotal(piece) > 0;
    if (!a || a.kind === "orphan") {
      if (piece.period !== P) continue;
      if (!counted && piece.net === 0) {
        // Sin ingreso ni neto no hay nada que mostrar; igual se clasifica
        // para que el puente no pierda ninguna línea del documento.
        otherMonth.add(piece.key);
        continue;
      }
      orphans.push(
        orphanOf(piece, a?.kind === "orphan" ? a.reason : "sin_reserva", null, a?.kind === "orphan" ? a.candidate_booking_ids : [], code),
      );
      continue;
    }
    let row: DraftRow | undefined;
    if (a.period === P) {
      row = rowByBooking.get(a.booking_id);
      if (!row) {
        const k = known.get(a.booking_id);
        if (k && k.mode === "mensual") row = rowByGroup.get(k.lease_group_id ?? a.booking_id);
      }
    }
    if (row) {
      row.pieces.push({ piece, matched_by: "fechas", counted });
      continue;
    }
    if (piece.period === P) otherMonth.add(piece.key);
  }

  return { attached, orphans, otherMonthPieceKeys: otherMonth };
}

// ── Evaluación de una fila ───────────────────────────────────────────────────

export interface EvalContext {
  year: number;
  month: number;
  org: ReconcileOrgInput;
  units: Map<string, UnitInput>;
  firstSettlementPeriod: number | null;
  /**
   * Primer período de la ventana de liquidaciones (`settlementWindow().from`).
   * Una estadía larga que empezó antes no tiene toda su historia cargada.
   * null = sin tope (sólo `firstSettlementPeriod`).
   */
  windowFrom?: number | null;
  /** Zona horaria de la org, para imputar cobros extra al mes del movimiento. */
  timezone?: string | null;
  /** Liquidaciones del período (y,m) por `owner_id`. */
  periodDocsByOwner: Map<string, GroupableSettlement[]>;
  /** Porciones no sintéticas de toda la ventana por `ref_id` (para `contrato_incompleto`). */
  piecesByRef: Map<string, BookingLinePiece[]>;
  extraChargesByRef: Map<string, ExtraChargeInput[]>;
}

const ownerKeyOf = (p: { owner_id: string | null; owner_name: string }) => p.owner_id ?? `__${p.owner_name}`;

const liqHref = (id: string) => `/dashboard/liquidaciones/${id}`;

/** La más reciente primero: período y, a igualdad, fecha de generación. */
function byRecency(a: BookingLinePiece, b: BookingLinePiece): number {
  return b.period - a.period || b.generated_at.localeCompare(a.generated_at);
}

interface PieceSums {
  R: number;
  Reint: number;
  C: number;
  Pliq: number;
  E: number;
  N: number;
  other: Record<string, number>;
  foreign: boolean;
}

function sumPieces(pieces: BookingLinePiece[], currency: string): PieceSums {
  let R = 0;
  let Reint = 0;
  let C = 0;
  let Pliq = 0;
  let E = 0;
  let foreign = false;
  const other: Record<string, number> = {};
  for (const p of pieces) {
    for (const [c, v] of Object.entries(p.revenue)) {
      if (c === currency) R += v;
      else if (v !== 0) {
        other[c] = (other[c] ?? 0) + v;
        foreign = true;
      }
    }
    // Los descuentos de una porción en otra moneda no se mezclan con los de la
    // reserva: la fila ya queda fuera de los totales por `moneda_distinta`.
    if (p.currency === currency) {
      Reint += p.reimbursements;
      C += p.commission;
      Pliq += p.channel;
      E += p.expenses;
    } else foreign = true;
  }
  R = round2(R);
  Reint = round2(Reint);
  C = round2(C);
  Pliq = round2(Pliq);
  E = round2(E);
  for (const c of Object.keys(other)) other[c] = round2(other[c]);
  return { R, Reint, C, Pliq, E, N: round2(R + Reint - C - Pliq - E), other, foreign };
}

export function evaluateRow(draft: DraftRow, ctx: EvalContext): ReconciledRow {
  const { year: y, month: m, org } = ctx;
  const P = periodIndex(y, m);
  const { days } = monthBounds(y, m);
  const unit = ctx.units.get(draft.unit_id);
  const unitCode = unit?.code ?? "—";
  const cur = draft.currency;
  const G = draft.guest_total;
  const Pc = draft.channel_commission;
  const reservaHref = `/dashboard/reservas/${draft.primary.id}`;
  const unitHref = `/dashboard/unidades/${draft.unit_id}`;

  const all = draft.pieces;
  const counted = all.filter((a) => a.counted);
  const countedPieces = counted.map((a) => a.piece).sort(byRecency);
  const latest = countedPieces[0] ?? null;
  const sums = sumPieces(countedPieces, cur);
  const { R, Reint, C, Pliq, E, N } = sums;

  // ── Co-propiedad ──
  const unitOwners = unit?.owners ?? [];
  const pctOf = (o: UnitOwnerInput) => (o.ownership_pct === null || o.ownership_pct === undefined ? 100 : num(o.ownership_pct));
  const sumPct = round2(unitOwners.reduce((a, o) => a + pctOf(o), 0));
  const ownerIds = new Set(unitOwners.map((o) => o.owner_id));
  // Participación normalizada: con VEL727 al 100% + 100% cada dueño es la
  // mitad del depto. La fila igual queda sin conciliar por `participaciones`,
  // pero así las partes siguen sumando G y ningún agregado cuenta dos veces.
  const shareOf = (o: UnitOwnerInput) =>
    sumPct > 0 ? pctOf(o) / sumPct : unitOwners.length > 0 ? 1 / unitOwners.length : 1;

  const piecesByOwner = new Map<string, AttachedPiece[]>();
  for (const a of counted) {
    const k = ownerKeyOf(a.piece);
    const arr = piecesByOwner.get(k);
    if (arr) arr.push(a);
    else piecesByOwner.set(k, [a]);
  }

  let coveredPct: number;
  if (unitOwners.length === 0) {
    // Sin dueños cargados no hay contra qué medir la cobertura: si hay porciones
    // se da por cubierta (la fila ya no concilia por `sin_propietario`).
    coveredPct = counted.length > 0 ? 100 : 0;
  } else {
    const coveredRaw = unitOwners
      .filter((o) => piecesByOwner.has(o.owner_id))
      .reduce((a, o) => a + pctOf(o), 0);
    coveredPct = sumPct > 0 ? round2(Math.min(100, (coveredRaw / sumPct) * 100)) : 0;
  }
  const G_cov = round2((G * coveredPct) / 100);
  const P_cov = round2((Pc * coveredPct) / 100);
  const D_calc = round2(G_cov - P_cov - (R - Pliq));

  const issues: RowIssue[] = [];
  const flags = new Set<InfoFlag>();
  const push = (code: IssueCode, detail: string, atStake: number, href: string, cta: string, atStakeCurrency = cur) => {
    issues.push({
      code,
      group: ISSUE_META[code].group,
      detail,
      at_stake: round2(atStake),
      at_stake_currency: atStakeCurrency,
      href,
      cta,
    });
  };

  // 1 · Unidad
  if (unitOwners.length === 0) {
    push("sin_propietario", ISSUE_TEXT.sinPropietario(unitCode), G, unitHref, REVIEW_GROUP_META.unidad.cta);
  } else {
    const details: string[] = [];
    if (Math.abs(sumPct - 100) > 0.001) details.push(ISSUE_TEXT.participacionesSuma(unitCode, sumPct));
    const stranger = countedPieces.find((p) => !p.owner_id || !ownerIds.has(p.owner_id));
    if (stranger) details.push(ISSUE_TEXT.participacionesAjeno(stranger.owner_name, unitCode));
    if (details.length > 0) {
      push(
        "participaciones",
        details.join(" "),
        counted.length > 0 ? Math.abs(R - G) : G,
        unitHref,
        REVIEW_GROUP_META.unidad.cta,
      );
    }
  }

  // 2 · Importe de la reserva
  const reservaCta = REVIEW_GROUP_META.importe_reserva.cta;
  if (G <= 0) {
    push("sin_precio", ISSUE_TEXT.sinPrecio(R, cur), R, reservaHref, reservaCta);
  }
  if (cur === "ARS" && G > 0 && draft.nights > 0 && G / draft.nights < MIN_ARS_PER_NIGHT) {
    push(
      "importe_sospechoso",
      ISSUE_TEXT.importeSospechoso(G, draft.nights, cur),
      counted.length > 0 ? R : G,
      reservaHref,
      reservaCta,
    );
  }
  if (sums.foreign) {
    const otherEntries = Object.entries(sums.other).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const otherCur = otherEntries[0]?.[0] ?? countedPieces.find((p) => p.currency !== cur)?.currency ?? cur;
    push(
      "moneda_distinta",
      ISSUE_TEXT.monedaDistinta(cur, otherCur),
      sums.other[otherCur] ?? 0,
      reservaHref,
      reservaCta,
      otherCur,
    );
  }
  if (draft.mode === "mensual") {
    // Renta y total en 0 es `sin_precio`, no una renta inconsistente.
    const bad = draft.tramos.find(
      (t) => !t.consistent && (num(t.booking.monthly_rent) > 0 || num(t.booking.total_amount) > 0),
    );
    if (bad) {
      push(
        "renta_inconsistente",
        ISSUE_TEXT.rentaInconsistente(
          num(bad.booking.monthly_rent),
          num(bad.booking.total_amount),
          bad.nights_total,
          cur,
        ),
        counted.length > 0 ? Math.abs(G - R) : G,
        reservaHref,
        reservaCta,
      );
    }
    // Contrato con menos meses en el calendario de los que ya se liquidaron
    // (ALCORTA 1.900.000 contra 2.950.000 liquidados): la renta del mes puede
    // estar bien y aun así el contrato está incompleto.
    let sumR = 0;
    let fromPeriod: BookingLinePiece | null = null;
    for (const b of draft.group_bookings) {
      for (const p of ctx.piecesByRef.get(b.id) ?? []) {
        const v = p.revenue[cur] ?? 0;
        if (v === 0) continue;
        sumR += v;
        if (!fromPeriod || p.period < fromPeriod.period) fromPeriod = p;
      }
    }
    sumR = round2(sumR);
    // Misma base que la liquidación (renta ÷ días de cada mes), no base 30.
    const sumTotal = round2(draft.group_bookings.reduce((a, b) => a + tramoLiquidationBase(b), 0));
    if (fromPeriod && sumR > sumTotal + TOL) {
      const fromLabel =
        fromPeriod.period_year === y
          ? monthNameLower(fromPeriod.period_month)
          : `${monthNameLower(fromPeriod.period_month)} ${fromPeriod.period_year}`;
      push(
        "contrato_incompleto",
        ISSUE_TEXT.contratoIncompleto(sumTotal, fromLabel, sumR, cur),
        sumR - sumTotal,
        reservaHref,
        reservaCta,
      );
    }
  }

  // 3a · Prorrateo mensual mal contado. Va ANTES que "desactualizada" y la
  // excluye: settlements.ts cuenta el mes con fin inclusivo (un mes completo
  // sale 29/30, 11 líneas automáticas de septiembre 2026), así que si la
  // brecha es el prorrateo, decir "regenerala" manda al operador a
  // reproducir el mismo error. Resultados cuenta noches exactas y marca la
  // porción en vez de "corregirla" en silencio.
  //
  // Una fila editada (`!all_auto`) cuenta sólo si el importe sigue siendo el
  // que calculó el sistema con el prorrateo viejo: `updateSettlementBookingRow`
  // nunca reescribe `prorate_days`, así que el número solo no alcanza (ROND.134
  // dice 29 y el importe está corregido → coincide), pero DEHEZA2 agosto
  // (manual, 914.516,13 = 945.000 × 30/31) es exactamente el automático y su
  // noche de menos se leía como diferencia de tarifa.
  //
  // En juego: lo que valen las noches mal contadas, no |D| (que mezclaría la
  // noche con cualquier otro error de la fila y repetiría el monto de
  // "Revisá el importe de la reserva").
  let prorateMiscount = false;
  if (draft.mode === "mensual") {
    let stake = 0;
    let firstHit: { piece: BookingLinePiece; nights: number } | null = null;
    for (const a of counted) {
      const p = a.piece;
      if (a.matched_by !== "ref" || p.period !== P || p.prorate_days === null) continue;
      const tramo = draft.group_bookings.find((b) => b.id === p.ref_id);
      if (!tramo) continue;
      const n = monthOverlapNights(tramo.check_in_date, tramo.check_out_date, y, m);
      if (p.prorate_days === n) continue;
      const rent = num(tramo.monthly_rent);
      const total = num(tramo.total_amount);
      const N = nightsBetween(tramo.check_in_date, tramo.check_out_date);
      // Participación como la genera settlements.ts: ownership_pct ?? 100, sin normalizar.
      const uo = unitOwners.find((o) => o.owner_id === p.owner_id);
      const share = uo ? pctOf(uo) / 100 : 1;
      if (!p.all_auto) {
        const oldAuto = round2((rent / days) * p.prorate_days * share);
        if (!(rent > 0) || Math.abs((p.revenue[cur] ?? 0) - oldAuto) > TOL) continue;
      }
      const perNight = isConsistentTramo(rent, total, N) ? rent / days : N > 0 ? total / N : 0;
      stake += perNight * Math.abs(n - p.prorate_days) * share;
      if (!firstHit) firstHit = { piece: p, nights: n };
    }
    if (firstHit) {
      push(
        "prorrateo_viejo",
        ISSUE_TEXT.prorrateoViejo(firstHit.piece.prorate_days as number, firstHit.nights),
        stake,
        liqHref(firstHit.piece.settlement_id),
        REVIEW_GROUP_META.prorrateo_mensual.cta,
      );
      prorateMiscount = true;
    }
  }

  // 3b · Liquidación desactualizada
  if (!prorateMiscount && latest && countedPieces.every((p) => p.all_auto)) {
    // Líneas sin tocar y reserva modificada después de generar: QUIROS1 y
    // SAL648 se generaron con la reserva de Booking en $0 y el precio se cargó
    // después. No es margen, es un documento viejo.
    const maxUpdated = draft.tramos.reduce(
      (a, t) => (t.booking.updated_at > a ? t.booking.updated_at : a),
      "",
    );
    const newest = countedPieces.reduce((a, p) => (Date.parse(p.generated_at) > Date.parse(a.generated_at) ? p : a));
    if (
      maxUpdated &&
      Date.parse(maxUpdated) > Date.parse(newest.generated_at) &&
      (Math.abs(D_calc) > TOL || (R <= 0 && G > 0))
    ) {
      push(
        "liquidacion_vieja",
        ISSUE_TEXT.liquidacionVieja(maxUpdated, monthNameLower(newest.period_month), newest.generated_at, newest.status),
        Math.abs(D_calc),
        liqHref(newest.settlement_id),
        REVIEW_GROUP_META.liquidacion_desactualizada.cta,
      );
    }
  }

  // 5 · Falta en la liquidación
  const missingOwners = unitOwners.filter((o) => !piecesByOwner.has(o.owner_id));
  const missingWithDoc = missingOwners.filter((o) => (ctx.periodDocsByOwner.get(o.owner_id) ?? []).length > 0);
  if (missingWithDoc.length > 0) {
    const doc = ctx.periodDocsByOwner.get(missingWithDoc[0].owner_id)![0];
    push(
      "falta_en_liquidacion",
      ISSUE_TEXT.faltaEnLiquidacion(
        missingWithDoc.map((o) => o.owner_name).join(" y "),
        monthNameLower(m),
        doc.status,
      ),
      (G * (100 - coveredPct)) / 100,
      liqHref(doc.id),
      REVIEW_GROUP_META.falta_liquidar.cta,
    );
  }
  // Con la porción en otra moneda, R (en la moneda de la reserva) da 0 pero la
  // reserva SÍ está en la liquidación: eso ya es `moneda_distinta`. Decir "está
  // en $0" sería falso (TREJO2: USD 593,64 liquidada en ARS 1.880.000), y su
  // G_cov inflaría el "en juego" de "Falta en la liquidación" (CAS3, agosto 2026).
  if (latest && R <= 0 && G > 0 && !sums.foreign) {
    // ITU airbnb: cobrados 310.000 y la fila de la liquidación en 0.
    push(
      "cobrada_no_liquidada",
      ISSUE_TEXT.cobradaNoLiquidada(G, cur),
      G_cov,
      liqHref(latest.settlement_id),
      REVIEW_GROUP_META.falta_liquidar.cta,
    );
  }

  // 6 · Canal sin comisión. Con la porción en otra moneda D_calc resta pesos de
  // dólares (CAS3: ARS 1.005.882 contra USD 650): no hay diferencia que atribuirle
  // a la plataforma, y la fila ya queda sin conciliar por `moneda_distinta`.
  if (draft.channel_pct === null && D_calc > TOL && !sums.foreign) {
    push(
      "canal_sin_comision",
      ISSUE_TEXT.canalSinComision(draft.primary.source),
      D_calc,
      "/dashboard/configuracion/comisiones",
      REVIEW_GROUP_META.canal.cta,
    );
  }

  // ── Avisos informativos ──
  if (counted.some((a) => a.matched_by === "fechas")) flags.add("por_fechas");
  const distinctPeriods = new Set(countedPieces.map((p) => p.period));
  if (distinctPeriods.size > 1) flags.add("varios_periodos");
  if (draft.mode === "temporario" && draft.nights >= LONG_STAY_NIGHTS) {
    flags.add("estadia_larga");
    // DF-3 (30/03 → 30/06) empezó antes de la primera liquidación cargada: los
    // meses anteriores se liquidaron fuera del sistema y la diferencia contra
    // lo que se ve sería inventada. Lo mismo si empezó antes del tope de la
    // ventana: esas liquidaciones no se cargaron.
    const ciIdx = periodOf(draft.check_in_date).index;
    if (
      (ctx.firstSettlementPeriod !== null && ciIdx < ctx.firstSettlementPeriod) ||
      (ctx.windowFrom !== null && ctx.windowFrom !== undefined && ciIdx < ctx.windowFrom)
    ) {
      flags.add("historia_incompleta");
    }
  }
  if (all.some((a) => !a.counted && a.piece.synthetic)) flags.add("pieza_en_cero");

  // 7 · Diferencia de tarifa demasiado alta. La diferencia real ronda el 9%;
  // pasar el 50% casi siempre es un importe mal cargado o una estadía liquidada
  // sólo en parte. CAS1083 (19/07→18/08) figura en el calendario por 3.060.000
  // y se liquidó sobre 900.000: contarla sumaba 2.160.000 al ingreso de la
  // administración de agosto 2026 sin ningún aviso. Sale del margen y queda en
  // "Para revisar". Si otro aviso ya la dejó sin conciliar, o la estadía
  // empezó antes de la primera liquidación cargada (DF-3: los meses previos se
  // liquidaron fuera del sistema), no se repite.
  const diffBase = G_cov - P_cov;
  if (
    latest &&
    !sums.foreign &&
    D_calc > TOL &&
    diffBase > 0 &&
    (D_calc / diffBase) * 100 > HIGH_RATE_DIFF_PCT &&
    !issues.some((i) => ISSUE_META[i.code].nullsDiff) &&
    !flags.has("historia_incompleta")
  ) {
    push(
      "diferencia_alta",
      ISSUE_TEXT.diferenciaAlta(G_cov, R, (D_calc / diffBase) * 100, cur),
      D_calc,
      `/dashboard/reservas/${draft.primary.id}`,
      REVIEW_GROUP_META.importe_reserva.cta,
    );
  }

  // ── Diferencia y resultado ──
  const nullD = issues.some((i) => ISSUE_META[i.code].nullsDiff) || flags.has("historia_incompleta");
  const D = latest && !nullD ? D_calc : null;
  let outcome: Outcome;
  if (!latest) outcome = "estimada";
  else if (D === null) outcome = "sin_conciliar";
  else if (Math.abs(D) <= TOL) outcome = "coincide";
  else if (D > TOL) outcome = "diferencia";
  else outcome = "liquidado_de_mas";

  // 4 · Liquidado de más / posible doble
  if (outcome === "liquidado_de_mas" && latest && D !== null) {
    // TUCU: se pagaron 270.000 y se liquidaron 1.250.000. Nunca resta del
    // margen: un error de carga no es una pérdida de la administración.
    push(
      "liquidado_de_mas",
      ISSUE_TEXT.liquidadoDeMas(R, G_cov, cur),
      -D,
      liqHref(latest.settlement_id),
      REVIEW_GROUP_META.liquidado_de_mas.cta,
    );
  }
  for (const [, ownerAps] of piecesByOwner) {
    // Sólo las filas que liquidan algo. DF-3 (septiembre 2026): fila manual de
    // agosto por 1.350.000 + la automática de septiembre en $0. Eso no es
    // "liquidada dos veces" (el aviso real es `sin_precio`), y contarla sumaría
    // el mismo 1.350.000 en dos grupos del panel.
    const aps = ownerAps.filter((a) => pieceRevenueTotal(a.piece) > 0);
    if (aps.length < 2) continue;
    const periods = new Set(aps.map((a) => a.piece.period));
    const mixedMatch = aps.some((a) => a.matched_by === "ref") && aps.some((a) => a.matched_by === "fechas");
    if (periods.size < 2 && !mixedMatch) continue;
    const ownerPieces = aps.map((a) => a.piece).sort(byRecency);
    const uo = unitOwners.find((o) => o.owner_id === ownerPieces[0].owner_id);
    const G_o = uo ? G * shareOf(uo) : G;
    const s = sumPieces(ownerPieces, cur);
    if (!(s.R > G_o + TOL || s.foreign)) continue;
    // SARA: 900.000 en julio (fila manual con fechas corridas) + 900.000 en
    // agosto (la automática del check-out). TREJO2: dos filas en pesos de una
    // reserva en dólares.
    const labels = [...periods]
      .sort((a, b) => a - b)
      .map((pi) => {
        const p = ownerPieces.find((x) => x.period === pi)!;
        return shortPeriodLabel(p.period_year, p.period_month, y);
      });
    const otherCur = Object.keys(s.other)[0];
    push(
      "posible_doble",
      ISSUE_TEXT.posibleDoble(aps.length, labels.join("·")),
      s.foreign && otherCur ? s.other[otherCur] : s.R - G_o,
      liqHref(ownerPieces[0].settlement_id),
      REVIEW_GROUP_META.liquidado_de_mas.cta,
      s.foreign && otherCur ? otherCur : cur,
    );
    break;
  }

  // Prioridad estable: a igual prioridad, el orden en que se detectaron.
  issues.sort((a, b) => ISSUE_META[a.code].priority - ISSUE_META[b.code].priority);

  const coverage: Coverage = coveredPct >= 100 ? "liquidada" : coveredPct > 0 ? "parcial" : "sin_liquidar";
  if (coverage !== "sin_liquidar" && draft.pending > TOL) flags.add("saldo_huesped");
  const level: RowLevel = issues.length > 0 ? "revisar" : coverage === "sin_liquidar" ? "sin_liquidar" : "ok";

  // ── Estimación de la parte no liquidada ──
  const pctFor = (ownerOverride: number | null | undefined) =>
    resolveCommissionPct({
      source: draft.primary.source,
      ownerOverride,
      bySource: org.commission_by_source ?? null,
      unitPct: unit?.default_commission_pct ?? null,
      orgPct: org.default_commission_pct ?? null,
    }).pct;
  const monthExpenses = draft.tramos.reduce(
    (a, t) => a + (num(t.booking.monthly_expenses) / days) * t.nights_in_month,
    0,
  );
  const estimateFor = (share: number, pct: number): RowEstimated => {
    // Sin importe no hay nada que repartir: la limpieza como neto negativo
    // distorsionaría los totales (misma regla que la versión anterior).
    if (G <= 0) return { guest_total: 0, channel: 0, commission: 0, expenses: 0, owner_net: 0 };
    if (draft.mode === "mensual") {
      const g = round2(G * share);
      const commission = round2(g * (pct / 100));
      const expenses = round2(monthExpenses * share);
      return { guest_total: g, channel: 0, commission, expenses, owner_net: round2(g - commission - expenses) };
    }
    const eco = computeBookingEconomics({
      total: G,
      cleaningFee: draft.cleaning,
      channelPct: draft.channel_pct ?? 0,
      commissionPct: pct,
      commissionBase: org.commission_base,
      ownerShare: share,
    });
    return {
      guest_total: eco.total,
      channel: eco.channelCommission,
      commission: eco.commission,
      expenses: eco.cleaning,
      owner_net: eco.ownerNet,
    };
  };

  const owners: RowOwnerSplit[] = [];
  const estAcc = { any: false, channel: 0, commission: 0, expenses: 0, owner_net: 0 };
  const addEst = (e: RowEstimated) => {
    estAcc.any = true;
    estAcc.channel += e.channel;
    estAcc.commission += e.commission;
    estAcc.expenses += e.expenses;
    estAcc.owner_net += e.owner_net;
  };
  let weightedPct = 0;

  const splitWithPieces = (
    ownerId: string | null,
    ownerName: string,
    share: number,
    aps: AttachedPiece[],
  ): RowOwnerSplit => {
    const ps = aps.map((a) => a.piece).sort(byRecency);
    const s = sumPieces(ps, cur);
    const g = round2(G * share);
    const ch = round2(Pc * share);
    return {
      owner_id: ownerId,
      owner_name: ownerName,
      share_pct: round2(share * 100),
      guest_total: g,
      channel: ch,
      has_piece: true,
      owner_rate: s.R,
      rate_diff: D === null ? null : round2(g - ch - (s.R - s.Pliq)),
      commission: s.C,
      expenses: round2(s.E - s.Reint),
      owner_net: s.N,
      settlement_id: ps[0]?.settlement_id ?? null,
    };
  };

  if (unitOwners.length === 0) {
    const pct = pctFor(null);
    weightedPct = pct;
    if (counted.length > 0) {
      owners.push(splitWithPieces(null, "Sin propietario", 1, counted));
    } else {
      const e = estimateFor(1, pct);
      addEst(e);
      owners.push({
        owner_id: null,
        owner_name: "Sin propietario",
        share_pct: 100,
        guest_total: round2(G),
        channel: round2(Pc),
        has_piece: false,
        owner_rate: null,
        rate_diff: null,
        commission: e.commission,
        expenses: e.expenses,
        owner_net: e.owner_net,
        settlement_id: null,
      });
    }
  } else {
    for (const o of unitOwners) {
      const share = shareOf(o);
      const pct = pctFor(o.commission_pct_override);
      weightedPct += pct * share;
      const aps = piecesByOwner.get(o.owner_id);
      if (aps) {
        owners.push(splitWithPieces(o.owner_id, o.owner_name, share, aps));
        continue;
      }
      const e = estimateFor(share, pct);
      addEst(e);
      owners.push({
        owner_id: o.owner_id,
        owner_name: o.owner_name,
        share_pct: round2(share * 100),
        guest_total: round2(G * share),
        channel: round2(Pc * share),
        has_piece: false,
        owner_rate: null,
        rate_diff: null,
        commission: e.commission,
        expenses: e.expenses,
        owner_net: e.owner_net,
        settlement_id: ctx.periodDocsByOwner.get(o.owner_id)?.[0]?.id ?? null,
      });
    }
    // Porciones de alguien que no figura como dueño: se muestran con 0%.
    for (const aps of piecesByOwner.values()) {
      const p0 = aps[0].piece;
      if (p0.owner_id && ownerIds.has(p0.owner_id)) continue;
      owners.push({ ...splitWithPieces(p0.owner_id, p0.owner_name, 0, aps), share_pct: 0 });
    }
  }
  // `guest_total` es exactamente G − G_cov (no la suma de los repartos
  // redondeados): así settled + estimated + unreconciled cierra al centavo.
  const estimated: RowEstimated | null = estAcc.any
    ? {
        guest_total: round2(G - G_cov),
        channel: round2(estAcc.channel),
        commission: round2(estAcc.commission),
        expenses: round2(estAcc.expenses),
        owner_net: round2(estAcc.owner_net),
      }
    : null;

  const settled: RowSettled | null = latest
    ? {
        guest_total: G_cov,
        channel: P_cov,
        owner_rate: R,
        owner_rate_other: (() => {
          const entries = Object.entries(sums.other).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
          return entries.length > 0 ? { currency: entries[0][0], amount: entries[0][1] } : null;
        })(),
        settlement_channel: Pliq,
        reimbursements: Reint,
        commission: C,
        expenses: E,
        owner_net: N,
        rate_diff: D,
        rate_diff_pct: D !== null && G_cov - P_cov > 0 ? round2((D / (G_cov - P_cov)) * 100) : null,
      }
    : null;

  const conciliated = outcome === "coincide" || outcome === "diferencia";
  const unreconciled = outcome === "sin_conciliar" || outcome === "liquidado_de_mas";

  const pieces: PieceSummary[] = [...all]
    .sort((a, b) => a.piece.period - b.piece.period || a.piece.generated_at.localeCompare(b.piece.generated_at))
    .map((a) => ({
      key: a.piece.key,
      settlement_id: a.piece.settlement_id,
      owner_name: a.piece.owner_name,
      period_label: shortPeriodLabel(a.piece.period_year, a.piece.period_month, y),
      status: a.piece.status,
      currency: a.piece.currency,
      revenue: round2(a.piece.revenue[a.piece.currency] ?? 0),
      commission: a.piece.commission,
      channel: a.piece.channel,
      expenses: round2(a.piece.expenses - a.piece.reimbursements),
      net: a.piece.net,
      matched_by: a.matched_by,
      counted: a.counted,
      href: liqHref(a.piece.settlement_id),
    }));
  const periods = [...distinctPeriods]
    .sort((a, b) => a - b)
    .map((pi) => {
      const p = countedPieces.find((x) => x.period === pi)!;
      return shortPeriodLabel(p.period_year, p.period_month, y);
    });

  const bookingIds = draft.tramos.map((t) => t.booking.id);
  // Temporario: una sola fila por reserva, van todos. Mensual: un tramo toca
  // varios meses y el mismo cobro se repetía en cada uno (CORRO 25/06→25/09,
  // "Pago pdo Agosto-Septiembre" del 31/07 contado en julio, agosto y
  // septiembre). Cada cobro va al mes del movimiento, acotado a los meses del
  // tramo: así suma en exactamente una vista.
  const timeZone = ctx.timezone || DEFAULT_ORG_TIMEZONE;
  const extraItems =
    draft.mode === "temporario"
      ? bookingIds.flatMap((id) => ctx.extraChargesByRef.get(id) ?? [])
      : draft.tramos.flatMap((t) =>
          (ctx.extraChargesByRef.get(t.booking.id) ?? []).filter(
            (x) => extraChargePeriod(x, t.booking, timeZone) === P,
          ),
        );

  return {
    key: draft.key,
    booking_ids: bookingIds,
    primary_booking_id: draft.primary.id,
    unit_id: draft.unit_id,
    unit_code: unitCode,
    unit_name: unit?.name ?? "—",
    guest_name: draft.primary.guest_name,
    source: draft.primary.source,
    mode: draft.mode,
    check_in_date: draft.check_in_date,
    check_out_date: draft.check_out_date,
    nights: draft.nights,
    prorate: draft.prorate,
    currency: cur,
    guest_total: G,
    paid: draft.paid,
    pending: draft.pending,
    channel_commission: Pc,
    channel_pct: draft.channel_pct,
    commission_pct: round2(weightedPct),
    coverage,
    covered_pct: coveredPct,
    outcome,
    level,
    settled,
    estimated,
    parts: {
      settled: conciliated ? G_cov : 0,
      estimated: round2(G - G_cov),
      unreconciled: unreconciled ? G_cov : 0,
    },
    issues,
    flags: [...flags],
    pieces,
    periods,
    primary_settlement_id: latest?.settlement_id ?? null,
    owners,
    extra_charges: round2(extraItems.filter((x) => x.currency === cur).reduce((a, x) => a + num(x.amount), 0)),
    extra_charge_items: extraItems,
    excluded_from_totals: issues.some((i) => ISSUE_META[i.code].excludesFromTotals),
  };
}

/**
 * Mes al que se imputa un cobro extra de un tramo mensual: el del movimiento
 * (en la zona horaria de la org, como Caja), acotado entre el mes del check-in
 * y el de la última noche. Sin fecha legible, el mes del check-in.
 */
export function extraChargePeriod(
  x: Pick<ExtraChargeInput, "occurred_at">,
  tramo: Pick<ResultBookingInput, "check_in_date" | "check_out_date">,
  timeZone: string = DEFAULT_ORG_TIMEZONE,
): number {
  const first = periodOf(tramo.check_in_date).index;
  const last =
    nightsBetween(tramo.check_in_date, tramo.check_out_date) > 0
      ? periodOf(addDaysYmd(tramo.check_out_date.slice(0, 10), -1)).index
      : first;
  const ms = x.occurred_at ? Date.parse(x.occurred_at) : Number.NaN;
  if (!Number.isFinite(ms)) return first;
  let ymd: string;
  try {
    ymd = ymdInTz(new Date(ms), timeZone);
  } catch {
    ymd = ymdInTz(new Date(ms), DEFAULT_ORG_TIMEZONE);
  }
  return Math.min(last, Math.max(first, periodOf(ymd).index));
}

// ── Puente por propietario ───────────────────────────────────────────────────

/**
 * Explica la columna "Liquidación de {mes}": el neto del documento no es la
 * suma de las reservas del mes, porque el documento incluye reservas de otros
 * meses (IND1446, ALVEAR), filas sin reserva (DF-PH TRANDICIONAL, $548.000 por
 * mes) y otros cargos; y las reservas del mes pueden estar liquidadas en otros
 * documentos (CAS1152 en mayo, junio y julio).
 *
 * Invariante: lines_net = all_periods − other_periods + other_month + orphans
 * + other_charges, y es igual al neto de `buildSettledResults` para ese dueño.
 */
export function buildOwnerBridges(
  periodDocs: GroupableSettlement[],
  rows: ReconciledRow[],
  orphanKeys: Set<string>,
  otherMonthKeys: Set<string>,
  allDocs: GroupableSettlement[],
): OwnerBridge[] {
  const bridges = new Map<string, OwnerBridge>();
  const bridgeKey = (d: GroupableSettlement) => `${ownerKeyOf(d)}|${d.currency}`;
  const attachedKeys = new Set(rows.flatMap((r) => r.pieces.map((p) => p.key)));

  const signedInBase = (doc: GroupableSettlement, l: GroupableSettlement["lines"][number]) => {
    const raw = Number(l.amount);
    if (!Number.isFinite(raw)) return { value: 0, missing: false };
    const conv = convertToBase(raw, l.currency ?? doc.currency, doc.currency, doc.exchange_rates);
    return { value: l.sign === "+" ? conv.value : -conv.value, missing: conv.missingRate };
  };

  for (const doc of periodDocs) {
    const k = bridgeKey(doc);
    let b = bridges.get(k);
    if (!b) {
      b = {
        owner_id: doc.owner_id,
        owner_name: doc.owner_name,
        currency: doc.currency,
        settlement_ids: [],
        statuses: [],
        net_payable: 0,
        paid: true,
        month_rows_net_all_periods: 0,
        month_rows_net_other_periods: 0,
        other_month_rows_net: 0,
        orphans_net: 0,
        other_charges_net: 0,
        lines_net: 0,
        missing_rate: false,
      };
      bridges.set(k, b);
    }
    b.settlement_ids.push(doc.id);
    b.statuses.push(doc.status);
    b.net_payable += num(doc.net_payable);
    if (!doc.paid_at) b.paid = false;
    for (const l of doc.lines) {
      const { value, missing } = signedInBase(doc, l);
      if (missing) b.missing_rate = true;
      b.lines_net += value;
      if (!isBookingPieceLine(l)) {
        b.other_charges_net += value;
        continue;
      }
      const pk = `${doc.id}:${l.ref_id}`;
      if (orphanKeys.has(pk)) b.orphans_net += value;
      else if (otherMonthKeys.has(pk) || !attachedKeys.has(pk)) b.other_month_rows_net += value;
      else b.month_rows_net_all_periods += value;
    }
  }

  // Porciones de OTROS períodos colgadas de reservas de este mes: suman y
  // restan a la vez, para que el puente muestre de dónde sale la diferencia.
  const docsById = new Map(allDocs.map((d) => [d.id, d]));
  const periodIds = new Set(periodDocs.map((d) => d.id));
  const seen = new Set<string>();
  for (const r of rows) {
    for (const ps of r.pieces) {
      if (seen.has(ps.key)) continue;
      seen.add(ps.key);
      const doc = docsById.get(ps.settlement_id);
      if (!doc || periodIds.has(doc.id)) continue;
      const b = bridges.get(bridgeKey(doc));
      if (!b) continue;
      const refId = ps.key.slice(doc.id.length + 1);
      let net = 0;
      for (const l of doc.lines) {
        if (!isBookingPieceLine(l) || l.ref_id !== refId) continue;
        const { value, missing } = signedInBase(doc, l);
        if (missing) b.missing_rate = true;
        net += value;
      }
      b.month_rows_net_all_periods += net;
      b.month_rows_net_other_periods += net;
    }
  }

  const out = [...bridges.values()];
  for (const b of out) {
    b.net_payable = round2(b.net_payable);
    b.month_rows_net_all_periods = round2(b.month_rows_net_all_periods);
    b.month_rows_net_other_periods = round2(b.month_rows_net_other_periods);
    b.other_month_rows_net = round2(b.other_month_rows_net);
    b.orphans_net = round2(b.orphans_net);
    b.other_charges_net = round2(b.other_charges_net);
    b.lines_net = round2(b.lines_net);
  }
  return out.sort((a, b) => a.owner_name.localeCompare(b.owner_name) || a.currency.localeCompare(b.currency));
}

// ── Agregados ────────────────────────────────────────────────────────────────

function emptyFlow(): FlowAmounts {
  return { bookings: 0, guest_total: 0, channel: 0, rate_diff: 0, commission: 0, expenses_net: 0, owner_net: 0 };
}

function emptyEstimated(): EstimatedAmounts {
  return { bookings: 0, guest_total: 0, channel: 0, commission: 0, expenses: 0, owner_net: 0 };
}

function roundFlow(f: FlowAmounts): void {
  f.guest_total = round2(f.guest_total);
  f.channel = round2(f.channel);
  f.rate_diff = round2(f.rate_diff);
  f.commission = round2(f.commission);
  f.expenses_net = round2(f.expenses_net);
  f.owner_net = round2(f.owner_net);
}

function roundEstimated(e: EstimatedAmounts): void {
  e.guest_total = round2(e.guest_total);
  e.channel = round2(e.channel);
  e.commission = round2(e.commission);
  e.expenses = round2(e.expenses);
  e.owner_net = round2(e.owner_net);
}

const isConciliated = (r: ReconciledRow) => r.outcome === "coincide" || r.outcome === "diferencia";

/**
 * Por depto, por propietario o por canal. Las filas excluidas de los totales
 * (`moneda_distinta`, `importe_sospechoso`) sólo cuentan como "a revisar": sus
 * importes no son comparables y sumarlos rompería el cierre contra los totales.
 */
export function aggregateRows(
  rows: ReconciledRow[],
  view: AggregateView,
  ctx: {
    otherCharges: SettledResults;
    bridges: OwnerBridge[];
    /**
     * Con un filtro de modo (Temporarios/Mensuales) los otros cargos y el
     * puente sólo se pegan a deptos/dueños que tienen reservas de ese modo: si
     * no, "Por propietario" en Mensuales listaba decenas de dueños de
     * temporarias con Reservas "—" y un monto en "Otros cargos del mes".
     */
    onlyWithBookings?: boolean;
  },
): AggregateRow[] {
  type Acc = AggregateRow & { _names: Set<string>; _pctW: number; _pctBase: number; _pctAny: boolean };
  const accs = new Map<string, Acc>();
  const get = (key: string, init: () => Omit<AggregateRow, "bookings" | "bookings_review" | "bookings_estimated" | "guest_total" | "settled" | "estimated" | "overpaid_excess">): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = {
        ...init(),
        bookings: 0,
        bookings_review: 0,
        bookings_estimated: 0,
        guest_total: 0,
        settled: emptyFlow(),
        estimated: emptyEstimated(),
        overpaid_excess: 0,
        _names: new Set(),
        _pctW: 0,
        _pctBase: 0,
        _pctAny: false,
      };
      accs.set(key, a);
    }
    return a;
  };

  for (const r of rows) {
    if (view === "propietario") {
      for (const o of r.owners) {
        const a = get(`${o.owner_id ?? "none"}|${r.currency}`, () => ({
          key: `${o.owner_id ?? "none"}|${r.currency}`,
          label: o.owner_name,
          sublabel: null,
          currency: r.currency,
          other_charges_net: 0,
          channel_pct: null,
          bridge: null,
          owner_id: o.owner_id,
        }));
        a._names.add(r.unit_code);
        if (r.level === "revisar") a.bookings_review += 1;
        if (r.excluded_from_totals) continue;
        a.bookings += 1;
        a.guest_total += o.guest_total;
        if (o.has_piece) {
          if (isConciliated(r)) {
            a.settled.bookings += 1;
            a.settled.guest_total += o.guest_total;
            a.settled.channel += o.channel;
            a.settled.rate_diff += o.rate_diff ?? 0;
            a.settled.commission += o.commission;
            a.settled.expenses_net += o.expenses;
            a.settled.owner_net += o.owner_net;
          } else if (r.outcome === "liquidado_de_mas" && o.rate_diff !== null && o.rate_diff < 0) {
            a.overpaid_excess += -o.rate_diff;
          }
        } else {
          a.bookings_estimated += 1;
          a.estimated.bookings += 1;
          a.estimated.guest_total += o.guest_total;
          a.estimated.channel += o.channel;
          a.estimated.commission += o.commission;
          a.estimated.expenses += o.expenses;
          a.estimated.owner_net += o.owner_net;
        }
      }
      continue;
    }

    const a =
      view === "depto"
        ? get(`${r.unit_id}|${r.currency}`, () => ({
            key: `${r.unit_id}|${r.currency}`,
            label: r.unit_code,
            sublabel: r.unit_name,
            currency: r.currency,
            other_charges_net: 0,
            channel_pct: null,
            bridge: null,
            unit_id: r.unit_id,
          }))
        : get(`${r.source}|${r.currency}`, () => ({
            key: `${r.source}|${r.currency}`,
            label: BOOKING_SOURCE_META[r.source]?.label ?? r.source,
            sublabel: null,
            currency: r.currency,
            other_charges_net: null,
            channel_pct: null,
            bridge: null,
            source: r.source,
          }));
    if (view === "depto") for (const o of r.owners) if (o.owner_id) a._names.add(o.owner_name);
    if (r.level === "revisar") a.bookings_review += 1;
    if (r.excluded_from_totals) continue;
    a.bookings += 1;
    a.guest_total += r.guest_total;
    if (r.channel_pct !== null) {
      a._pctAny = true;
      a._pctW += r.channel_pct * r.guest_total;
      a._pctBase += r.guest_total;
    }
    if (r.settled && isConciliated(r)) {
      a.settled.bookings += 1;
      a.settled.guest_total += r.settled.guest_total;
      a.settled.channel += r.settled.channel;
      a.settled.rate_diff += r.settled.rate_diff ?? 0;
      a.settled.commission += r.settled.commission;
      a.settled.expenses_net += r.settled.expenses - r.settled.reimbursements;
      a.settled.owner_net += r.settled.owner_net;
    }
    if (r.outcome === "liquidado_de_mas" && r.settled?.rate_diff != null) {
      a.overpaid_excess += -r.settled.rate_diff;
    }
    if (r.estimated) {
      a.bookings_estimated += 1;
      a.estimated.bookings += 1;
      a.estimated.guest_total += r.estimated.guest_total;
      a.estimated.channel += r.estimated.channel;
      a.estimated.commission += r.estimated.commission;
      a.estimated.expenses += r.estimated.expenses;
      a.estimated.owner_net += r.estimated.owner_net;
    }
  }

  // Otros cargos del mes y el puente: también para deptos/dueños sin reservas
  // (un ticket de mantenimiento en un depto vacío igual se le descuenta).
  const skip = (key: string) => ctx.onlyWithBookings === true && !accs.has(key);
  if (view === "depto") {
    for (const u of ctx.otherCharges.by_unit) {
      const key = `${u.unit_id ?? "none"}|${u.currency}`;
      if (skip(key)) continue;
      const a = get(key, () => ({
        key,
        label: u.unit_code,
        sublabel: u.unit_name || null,
        currency: u.currency,
        other_charges_net: 0,
        channel_pct: null,
        bridge: null,
        unit_id: u.unit_id ?? undefined,
      }));
      a.other_charges_net = (a.other_charges_net ?? 0) + u.net;
    }
  } else if (view === "propietario") {
    for (const o of ctx.otherCharges.by_owner) {
      const key = `${o.owner_id ?? "none"}|${o.currency}`;
      if (skip(key)) continue;
      const a = get(key, () => ({
        key,
        label: o.owner_name,
        sublabel: null,
        currency: o.currency,
        other_charges_net: 0,
        channel_pct: null,
        bridge: null,
        owner_id: o.owner_id,
      }));
      a.other_charges_net = (a.other_charges_net ?? 0) + o.net;
    }
    for (const b of ctx.bridges) {
      const key = `${b.owner_id ?? "none"}|${b.currency}`;
      if (skip(key)) continue;
      const a = get(key, () => ({
        key,
        label: b.owner_name,
        sublabel: null,
        currency: b.currency,
        other_charges_net: 0,
        channel_pct: null,
        bridge: null,
        owner_id: b.owner_id,
      }));
      a.bridge = b;
    }
  }

  const out: AggregateRow[] = [];
  for (const a of accs.values()) {
    const { _names, _pctW, _pctBase, _pctAny, ...row } = a;
    row.guest_total = round2(row.guest_total);
    row.overpaid_excess = round2(row.overpaid_excess);
    if (row.other_charges_net !== null) row.other_charges_net = round2(row.other_charges_net);
    roundFlow(row.settled);
    roundEstimated(row.estimated);
    if (view === "depto") {
      const names = [..._names].sort();
      row.sublabel = [row.sublabel, names.join(", ")].filter(Boolean).join(" · ") || null;
    } else if (view === "propietario") {
      row.sublabel = _names.size > 0 ? [..._names].sort().join(", ") : null;
    } else {
      // "Sin comisión" sólo si ninguna reserva del canal tiene %.
      row.channel_pct = _pctAny ? (_pctBase > 0 ? round2(_pctW / _pctBase) : 0) : null;
    }
    out.push(row);
  }
  return out.sort((a, b) => b.guest_total - a.guest_total || a.label.localeCompare(b.label));
}

// ── Totales ──────────────────────────────────────────────────────────────────

export function computeTotals(rows: ReconciledRow[], extras: ExtraChargeInput[]): ResultTotals[] {
  const byCur = new Map<string, ResultTotals & { _base: number }>();
  const get = (currency: string) => {
    let t = byCur.get(currency);
    if (!t) {
      t = {
        currency,
        bookings: 0,
        guest_total: 0,
        paid: 0,
        pending: 0,
        by_mode: { temporario: 0, mensual: 0 },
        parts: { settled: 0, estimated: 0, unreconciled: 0 },
        settled: emptyFlow(),
        estimated: emptyEstimated(),
        admin_income: 0,
        rate_diff_pct: null,
        settled_share: 0,
        overpaid: { bookings: 0, excess: 0 },
        unreconciled_bookings: 0,
        extra_charges: 0,
        excluded_bookings: 0,
        _base: 0,
      };
      byCur.set(currency, t);
    }
    return t;
  };

  const rowIds = new Set<string>();
  for (const r of rows) {
    for (const id of r.booking_ids) rowIds.add(id);
    const t = get(r.currency);
    // Dólares cargados como pesos o una reserva en USD liquidada en ARS: sumar
    // cualquiera de los dos números mezcla monedas. Se cuentan aparte.
    if (r.excluded_from_totals) {
      t.excluded_bookings += 1;
      continue;
    }
    t.bookings += 1;
    t.guest_total += r.guest_total;
    t.paid += r.paid;
    t.pending += r.pending;
    t.by_mode[r.mode] += r.guest_total;
    t.parts.settled += r.parts.settled;
    t.parts.estimated += r.parts.estimated;
    t.parts.unreconciled += r.parts.unreconciled;
    if (r.settled && isConciliated(r)) {
      t.settled.bookings += 1;
      t.settled.guest_total += r.settled.guest_total;
      t.settled.channel += r.settled.channel;
      t.settled.rate_diff += r.settled.rate_diff ?? 0;
      t.settled.commission += r.settled.commission;
      t.settled.expenses_net += r.settled.expenses - r.settled.reimbursements;
      t.settled.owner_net += r.settled.owner_net;
      t._base += r.settled.guest_total - r.settled.channel;
    }
    if (r.estimated) {
      t.estimated.bookings += 1;
      t.estimated.guest_total += r.estimated.guest_total;
      t.estimated.channel += r.estimated.channel;
      t.estimated.commission += r.estimated.commission;
      t.estimated.expenses += r.estimated.expenses;
      t.estimated.owner_net += r.estimated.owner_net;
    }
    if (r.outcome === "sin_conciliar" || r.outcome === "liquidado_de_mas") t.unreconciled_bookings += 1;
    if (r.outcome === "liquidado_de_mas" && r.settled?.rate_diff != null) {
      t.overpaid.bookings += 1;
      t.overpaid.excess += -r.settled.rate_diff;
    }
  }
  // Cobros extra (cochera, luz, limpieza extra): aparte, nunca dentro de
  // "Paga el huésped" — hoy mezclan garantías y cuotas mal categorizadas
  // (CORRO $1.029.000 en julio).
  for (const x of extras) {
    if (!rowIds.has(x.ref_id)) continue;
    get(x.currency).extra_charges += num(x.amount);
  }

  const out: ResultTotals[] = [];
  for (const t of byCur.values()) {
    const { _base, ...tot } = t;
    tot.guest_total = round2(tot.guest_total);
    tot.paid = round2(tot.paid);
    tot.pending = round2(tot.pending);
    tot.by_mode = { temporario: round2(tot.by_mode.temporario), mensual: round2(tot.by_mode.mensual) };
    tot.parts = {
      settled: round2(tot.parts.settled),
      estimated: round2(tot.parts.estimated),
      unreconciled: round2(tot.parts.unreconciled),
    };
    roundFlow(tot.settled);
    roundEstimated(tot.estimated);
    tot.overpaid.excess = round2(tot.overpaid.excess);
    tot.extra_charges = round2(tot.extra_charges);
    tot.admin_income = round2(tot.settled.rate_diff + tot.settled.commission);
    tot.rate_diff_pct = round2(_base) > 0 ? round2((tot.settled.rate_diff / _base) * 100) : null;
    tot.settled_share = tot.bookings > 0 ? tot.settled.bookings / tot.bookings : 0;
    out.push(tot);
  }
  return out.sort((a, b) => b.bookings - a.bookings || a.currency.localeCompare(b.currency));
}

// ── Panel "Para revisar" ─────────────────────────────────────────────────────

function addAmount(list: Map<string, number>, currency: string, amount: number) {
  list.set(currency, (list.get(currency) ?? 0) + amount);
}

function amountsOf(list: Map<string, number>): Array<{ currency: string; amount: number }> {
  return [...list.entries()]
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export function buildReviewItems(
  rows: ReconciledRow[],
  orphans: OrphanRow[],
  channelsWithoutPct: BookingSource[],
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const groups: ReviewGroup[] = [
    "importe_reserva",
    "liquidacion_desactualizada",
    "prorrateo_mensual",
    "liquidado_de_mas",
    "falta_liquidar",
    "unidad",
  ];
  for (const g of groups) {
    const amounts = new Map<string, number>();
    let count = 0;
    for (const r of rows) {
      const own = r.issues.filter((i) => i.group === g);
      if (own.length === 0) continue;
      count += 1;
      // Dos avisos del mismo grupo en una fila suelen medir LA MISMA plata:
      // con un solo dueño `liquidado_de_mas` (−D) y `posible_doble` (R − G)
      // son el mismo monto (TUCU 1.250.000 contado dos veces), igual que
      // `renta_inconsistente` + `contrato_incompleto`. Se toma el mayor por
      // moneda, así el panel no contradice al KPI "Se liquidó de más".
      const top = new Map<string, number>();
      for (const i of own) {
        const prev = top.get(i.at_stake_currency);
        if (prev === undefined || Math.abs(i.at_stake) > Math.abs(prev)) top.set(i.at_stake_currency, i.at_stake);
      }
      for (const [c, v] of top) addAmount(amounts, c, v);
    }
    if (count === 0) continue;
    const meta = REVIEW_GROUP_META[g];
    items.push({ id: g, where: meta.where, label: meta.label, count, at_stake: amountsOf(amounts), filter: `aviso:${g}`, href: null });
  }

  const saldo = rows.filter((r) => r.flags.includes("saldo_huesped"));
  if (saldo.length > 0) {
    const amounts = new Map<string, number>();
    for (const r of saldo) addAmount(amounts, r.currency, r.pending);
    items.push({
      id: "saldo_huesped",
      where: REVIEW_EXTRA_META.saldo_huesped.where,
      label: REVIEW_EXTRA_META.saldo_huesped.label,
      count: saldo.length,
      at_stake: amountsOf(amounts),
      filter: "flag:saldo",
      href: null,
    });
  }

  if (orphans.length > 0) {
    const amounts = new Map<string, number>();
    for (const o of orphans) addAmount(amounts, o.currency, o.revenue);
    items.push({
      id: "sin_reserva",
      where: REVIEW_EXTRA_META.sin_reserva.where,
      label: REVIEW_EXTRA_META.sin_reserva.label,
      count: orphans.length,
      at_stake: amountsOf(amounts),
      filter: null,
      href: null,
    });
  }

  // El número del ítem cuenta las mismas filas que suman "en juego": las que
  // tienen el aviso. Antes contaba toda reserva de un canal sin % (8 en agosto
  // contra 3 con aviso). Sin filas con aviso no hay nada que revisar acá: el
  // chip "Sin comisión" de la vista Por canal sigue marcando el canal.
  const withChannelIssue = rows.filter((r) => r.issues.some((i) => i.group === "canal"));
  if (channelsWithoutPct.length > 0 && withChannelIssue.length > 0) {
    const amounts = new Map<string, number>();
    for (const r of withChannelIssue) {
      for (const i of r.issues) if (i.group === "canal") addAmount(amounts, i.at_stake_currency, i.at_stake);
    }
    const names = channelsWithoutPct.map((s) => BOOKING_SOURCE_META[s]?.label ?? s).join(", ");
    items.push({
      id: "canal",
      where: REVIEW_GROUP_META.canal.where,
      label: `${REVIEW_GROUP_META.canal.label} (${names})`,
      count: withChannelIssue.length,
      at_stake: amountsOf(amounts),
      filter: null,
      href: "/dashboard/configuracion/comisiones",
    });
  }

  const topAmount = (i: ReviewItem) => Math.abs(i.at_stake[0]?.amount ?? 0);
  return items.sort(
    (a, b) =>
      REVIEW_WHERE_ORDER.indexOf(a.where) - REVIEW_WHERE_ORDER.indexOf(b.where) || topAmount(b) - topAmount(a),
  );
}

// ── Cierre del mes ───────────────────────────────────────────────────────────

/**
 * Franja "Cierre de {mes}". Los netos salen de las líneas (`lines_net` del
 * puente), no de la cabecera: `net_payable` es cache y en producción hay
 * documentos desincronizados (regla 3 de settled-model.ts).
 */
function buildMonthClose(
  rows: ReconciledRow[],
  periodDocs: GroupableSettlement[],
  bridges: OwnerBridge[],
): MonthClose[] {
  const byCur = new Map<string, MonthClose & { _owners: Set<string> }>();
  const get = (currency: string) => {
    let c = byCur.get(currency);
    if (!c) {
      c = {
        currency,
        owners_with_bookings: 0,
        settlements: 0,
        settlements_paid: 0,
        net_payable: 0,
        net_paid: 0,
        net_pending: 0,
        bookings_not_settled: 0,
        bookings_missing_price: 0,
        extra_charges: 0,
        _owners: new Set(),
      };
      byCur.set(currency, c);
    }
    return c;
  };
  for (const r of rows) {
    const c = get(r.currency);
    for (const o of r.owners) if (o.owner_id && o.share_pct > 0) c._owners.add(o.owner_id);
    // Mismo universo que "Sin liquidar" de la cobertura (computeTotals): las
    // filas fuera de los totales no se cuentan.
    if (r.coverage !== "liquidada" && !r.excluded_from_totals) c.bookings_not_settled += 1;
    if (r.issues.some((i) => i.code === "sin_precio")) c.bookings_missing_price += 1;
    c.extra_charges += r.extra_charges;
  }
  for (const d of periodDocs) {
    const c = get(d.currency);
    c.settlements += 1;
    if (d.paid_at) c.settlements_paid += 1;
  }
  for (const b of bridges) {
    const c = get(b.currency);
    c.net_payable += b.lines_net;
    if (b.paid) c.net_paid += b.lines_net;
  }
  return [...byCur.values()]
    .map(({ _owners, ...c }) => ({
      ...c,
      owners_with_bookings: _owners.size,
      net_payable: round2(c.net_payable),
      net_paid: round2(c.net_paid),
      net_pending: round2(c.net_payable - c.net_paid),
      extra_charges: round2(c.extra_charges),
    }))
    .sort((a, b) => b.settlements - a.settlements || a.currency.localeCompare(b.currency));
}

// ── Orquestación pura ────────────────────────────────────────────────────────

function toSettledInput(doc: GroupableSettlement, units: Map<string, UnitInput>): SettledSettlementInput {
  return {
    id: doc.id,
    status: doc.status,
    currency: doc.currency,
    exchange_rates: doc.exchange_rates ?? {},
    paid_at: doc.paid_at,
    owner: doc.owner_id ? { id: doc.owner_id, full_name: doc.owner_name } : null,
    lines: doc.lines.map((l) => {
      const u = l.unit_id ? units.get(l.unit_id) : undefined;
      return {
        line_type: l.line_type,
        amount: l.amount,
        sign: l.sign,
        unit_id: l.unit_id,
        currency: l.currency,
        ref_type: l.ref_type,
        ref_id: l.ref_id,
        unit: u ? { id: u.id, code: u.code, name: u.name } : null,
      };
    }),
  };
}

function rowSortKey(r: ReconciledRow): number {
  return r.issues.reduce((a, i) => Math.max(a, Math.abs(i.at_stake)), 0);
}

export function reconcileMonth(input: ReconcileInput): ReconciledMonth {
  const { year: y, month: m } = input;
  const P = periodIndex(y, m);
  const docs = dedupeById(input.settlements);
  const units = new Map(input.units.map((u) => [u.id, u]));
  const pool = dedupeById([...input.bookings, ...input.candidates]);
  // Fechas de la reserva de cada `ref_id` conocida (Q1 ∪ Q3 ∪ Q5a, y Q5b que
  // trae también canceladas): una fila reusada para otra estadía se empareja
  // por fechas, como una sintética.
  const refDates = new Map<string, { check_in_date: string; check_out_date: string }>();
  for (const b of pool) refDates.set(b.id, b);
  for (const r of input.refLookups) {
    if (r.check_in_date && !refDates.has(r.id)) {
      refDates.set(r.id, { check_in_date: r.check_in_date, check_out_date: r.check_out_date });
    }
  }
  const allPieces = docs
    .flatMap((d) => groupBookingLines(d))
    .map((p) => (isDeadRefPiece(p, refDates.get(p.ref_id)) ? { ...p, synthetic: true } : p));

  const assignments = new Map<string, SyntheticAssignment>();
  for (const p of allPieces) if (p.synthetic) assignments.set(p.key, assignSyntheticPiece(p, pool));

  const drafts = buildDraftRows(input);
  const { attached, orphans, otherMonthPieceKeys } = attachPieces(drafts, allPieces, assignments, y, m, {
    refLookups: input.refLookups,
    bookings: pool,
    units: input.units,
  });

  const periodDocs = docs.filter((d) => periodIndex(d.period_year, d.period_month) === P);
  const periodDocsByOwner = new Map<string, GroupableSettlement[]>();
  for (const d of periodDocs) {
    if (!d.owner_id) continue;
    const arr = periodDocsByOwner.get(d.owner_id);
    if (arr) arr.push(d);
    else periodDocsByOwner.set(d.owner_id, [d]);
  }
  const piecesByRef = new Map<string, BookingLinePiece[]>();
  for (const p of allPieces) {
    if (p.synthetic) continue;
    const arr = piecesByRef.get(p.ref_id);
    if (arr) arr.push(p);
    else piecesByRef.set(p.ref_id, [p]);
  }
  const extraChargesByRef = new Map<string, ExtraChargeInput[]>();
  for (const x of input.extraCharges) {
    const arr = extraChargesByRef.get(x.ref_id);
    if (arr) arr.push(x);
    else extraChargesByRef.set(x.ref_id, [x]);
  }

  const ctx: EvalContext = {
    year: y,
    month: m,
    org: input.org,
    units,
    firstSettlementPeriod: input.firstSettlementPeriod,
    windowFrom: settlementWindow(input).from,
    timezone: input.org.timezone ?? null,
    periodDocsByOwner,
    piecesByRef,
    extraChargesByRef,
  };
  const allRows = attached
    .map((d) => evaluateRow(d, ctx))
    .sort((a, b) => {
      const ra = a.level === "revisar" ? 0 : 1;
      const rb = b.level === "revisar" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (ra === 0) {
        const d = rowSortKey(b) - rowSortKey(a);
        if (d !== 0) return d;
      }
      return (
        Math.abs(b.settled?.rate_diff ?? 0) - Math.abs(a.settled?.rate_diff ?? 0) ||
        b.guest_total - a.guest_total ||
        a.key.localeCompare(b.key)
      );
    });

  // El puente mira TODAS las filas: el documento del propietario no se parte
  // por modo, así que filtrar antes rompería la invariante.
  const bridges = buildOwnerBridges(
    periodDocs,
    allRows,
    new Set(orphans.map((o) => o.key)),
    otherMonthPieceKeys,
    docs,
  );

  const rows = input.mode === "todos" ? allRows : allRows.filter((r) => r.mode === input.mode);
  const otherCharges = buildSettledResults(
    periodDocs.map((d) => toSettledInput(d, units)),
    { lineFilter: (l) => !isBookingPieceLine(l) },
  );
  const channelsWithoutPct = [
    ...new Set(rows.filter((r) => r.channel_pct === null).map((r) => r.source)),
  ].sort();

  const onlyWithBookings = input.mode !== "todos";

  return {
    rows,
    // Los cobros ya imputados a cada fila (un mensual, sólo los del mes).
    totals: computeTotals(rows, rows.flatMap((r) => r.extra_charge_items)),
    by_unit: aggregateRows(rows, "depto", { otherCharges, bridges, onlyWithBookings }),
    by_owner: aggregateRows(rows, "propietario", { otherCharges, bridges, onlyWithBookings }),
    by_channel: aggregateRows(rows, "canal", { otherCharges, bridges, onlyWithBookings }),
    orphans,
    bridges,
    review: buildReviewItems(rows, orphans, channelsWithoutPct),
    close: buildMonthClose(rows, periodDocs, bridges),
    missing_price_count: rows.filter((r) => r.issues.some((i) => i.code === "sin_precio")).length,
    channels_without_pct: channelsWithoutPct,
  };
}
