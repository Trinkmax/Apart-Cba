/**
 * Resultados del mes — lectura de las filas y armado del `ReconcileInput`.
 *
 * Es la parte de `getMonthlyResults` (src/lib/actions/results.ts) que habla con
 * la base: trae las filas, las tipa y deja todo listo para `reconcileMonth`.
 * Vive aparte para que la verificación contra datos reales corra EXACTAMENTE
 * las mismas queries y el mismo mapeo que la página, sin sesión ni cookies.
 *
 * SÓLO SERVIDOR. Recibe el cliente admin (service_role, sin RLS): no importar
 * desde componentes cliente. El borde de seguridad sigue en la acción, que
 * chequea sesión, org activa y `can(role,'payments','view')` antes de llamar
 * acá. Toda query filtra por `organization_id = orgId`.
 *
 * Queries por ronda:
 *   Ronda 1 — Q1 reservas que tocan el mes · Q2 unidades con dueños · Q7 primera
 *             liquidación de la org · Q4a liquidaciones del mes con TODAS sus
 *             líneas (no depende de nada, así que no espera a la ronda 2).
 *   Ronda 2 — Q3 tramos de los contratos mensuales → Q4b resto de la ventana de
 *             liquidaciones (sólo líneas de reserva; la ventana necesita el
 *             check-in más temprano de cada contrato) · en paralelo Q6 cobros
 *             extra de las reservas del mes.
 *   Ronda 3 — Q5a candidatas de las filas sintéticas · Q5b refs del mes sin fila.
 */

import type { createAdminClient } from "@/lib/supabase/server";
import { monthBounds, periodFromIndex, periodIndex } from "@/lib/finance/prorate";
import {
  ACTIVE_BOOKING_STATUSES,
  collectLookups,
  settlementWindow,
  type ExtraChargeInput,
  type GroupableLine,
  type GroupableSettlement,
  type ReconcileInput,
  type ReconcileOrgInput,
  type RefLookupInput,
  type ResultBookingInput,
  type ResultsMode,
  type UnitInput,
} from "@/lib/finance/results-reconciliation";
import type { BookingSource, BookingStatus, SettlementStatus } from "@/lib/types/database";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Tamaños ──────────────────────────────────────────────────────────────────

/**
 * Liquidaciones por página: cada una trae sus líneas embebidas. Con 500 la
 * ventana entera (~630 KB) viajaba en UNA respuesta bajo el tier REST de 10 s
 * de fetchWithTimeout; en páginas de 200 cada respuesta queda acotada.
 */
const SETTLEMENT_PAGE = 200;
/** Filas planas por página (tope de PostgREST: 1000). */
const ROWS_PAGE = 1000;
/** Valores por `.in(...)`: 150 uuids ≈ 5,5 KB de URL. */
const IN_CHUNK = 150;

const ACTIVE_STATUSES: BookingStatus[] = [...ACTIVE_BOOKING_STATUSES];

// ── Filas de Supabase ────────────────────────────────────────────────────────

type Numeric = number | string | null;

const BOOKING_SELECT =
  "id, unit_id, lease_group_id, source, status, mode, check_in_date, check_out_date, currency, total_amount, paid_amount, cleaning_fee, commission_pct, channel_commission_pct, monthly_rent, monthly_expenses, updated_at, guest:guests(full_name)";

interface BookingRow {
  id: string;
  unit_id: string;
  lease_group_id: string | null;
  source: BookingSource;
  status: BookingStatus;
  mode: string | null;
  check_in_date: string;
  check_out_date: string;
  currency: string | null;
  total_amount: Numeric;
  paid_amount: Numeric;
  cleaning_fee: Numeric;
  commission_pct: Numeric;
  channel_commission_pct: Numeric;
  monthly_rent: Numeric;
  monthly_expenses: Numeric;
  updated_at: string;
  guest: { full_name: string | null } | null;
}

const UNIT_SELECT =
  "id, code, name, default_commission_pct, owners:unit_owners(owner_id, ownership_pct, commission_pct_override, owner:owners(full_name))";

interface UnitRow {
  id: string;
  code: string;
  name: string;
  default_commission_pct: Numeric;
  owners: Array<{
    owner_id: string | null;
    ownership_pct: Numeric;
    commission_pct_override: Numeric;
    owner: { full_name: string | null } | null;
  }> | null;
}

const LINE_FIELDS = "id, line_type, amount, sign, currency, unit_id, ref_type, ref_id, is_manual, meta";
const SETTLEMENT_SELECT = `id, owner_id, status, period_year, period_month, currency, generated_at, paid_at, net_payable, exchange_rates, owner:owners(full_name), lines:settlement_lines(${LINE_FIELDS})`;

interface LineRow {
  id: string;
  line_type: GroupableLine["line_type"];
  amount: Numeric;
  sign: "+" | "-";
  currency: string | null;
  unit_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  is_manual: boolean | null;
  meta: Record<string, unknown> | null;
}

interface SettlementRow {
  id: string;
  owner_id: string | null;
  status: SettlementStatus;
  period_year: number;
  period_month: number;
  currency: string | null;
  generated_at: string | null;
  paid_at: string | null;
  net_payable: Numeric;
  exchange_rates: Record<string, Numeric> | null;
  owner: { full_name: string | null } | null;
  lines: LineRow[] | null;
}

interface FirstSettlementRow {
  period_year: number;
  period_month: number;
}

interface RefLookupRow {
  id: string;
  status: BookingStatus;
  is_block: boolean | null;
  mode: string | null;
  check_in_date: string;
  check_out_date: string;
}

interface ExtraChargeRow {
  ref_id: string;
  amount: Numeric;
  currency: string | null;
  billable_to: string | null;
  description: string | null;
  occurred_at: string | null;
}

// ── Helpers de lectura ───────────────────────────────────────────────────────

type QueryResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Recorre `.range()` hasta que una página vuelve incompleta. El builder debe ordenar por algo único. */
async function fetchAllPages<T>(page: (from: number, to: number) => QueryResult, size: number): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

/** `.in(col, values)` partido en tandas (URL acotada), cada tanda paginada, todas en paralelo. */
async function fetchInChunks<T>(
  values: string[],
  page: (chunk: string[], from: number, to: number) => QueryResult,
  size: number,
): Promise<T[]> {
  if (values.length === 0) return [];
  const tandas: string[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) tandas.push(values.slice(i, i + IN_CHUNK));
  const results = await Promise.all(
    tandas.map((chunk) => fetchAllPages<T>((from, to) => page(chunk, from, to), size)),
  );
  return results.flat();
}

function toNum(v: Numeric | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: Numeric | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function toBookingInput(r: BookingRow): ResultBookingInput {
  return {
    id: r.id,
    unit_id: r.unit_id,
    lease_group_id: r.lease_group_id,
    guest_name: r.guest?.full_name ?? null,
    source: r.source,
    status: r.status,
    mode: r.mode === "mensual" ? "mensual" : "temporario",
    check_in_date: r.check_in_date,
    check_out_date: r.check_out_date,
    currency: r.currency,
    total_amount: toNum(r.total_amount),
    paid_amount: toNum(r.paid_amount),
    cleaning_fee: toNumOrNull(r.cleaning_fee),
    commission_pct: toNumOrNull(r.commission_pct),
    channel_commission_pct: toNumOrNull(r.channel_commission_pct),
    monthly_rent: toNumOrNull(r.monthly_rent),
    monthly_expenses: toNumOrNull(r.monthly_expenses),
    updated_at: r.updated_at,
  };
}

function toUnitInput(u: UnitRow): UnitInput {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    default_commission_pct: toNumOrNull(u.default_commission_pct),
    owners: (u.owners ?? [])
      .filter((o): o is typeof o & { owner_id: string } => !!o.owner_id)
      .map((o) => ({
        owner_id: o.owner_id,
        owner_name: o.owner?.full_name ?? "Propietario",
        ownership_pct: toNumOrNull(o.ownership_pct),
        commission_pct_override: toNumOrNull(o.commission_pct_override),
      })),
  };
}

function toLineMeta(meta: LineRow["meta"]): GroupableLine["meta"] {
  if (!meta || typeof meta !== "object") return null;
  return {
    source: strOrNull(meta.source),
    check_in: strOrNull(meta.check_in),
    check_out: strOrNull(meta.check_out),
    guest_name: strOrNull(meta.guest_name),
    nights: toNumOrNull(meta.nights as Numeric),
    prorate_days: toNumOrNull(meta.prorate_days as Numeric),
    mode: strOrNull(meta.mode),
  };
}

function toGroupable(s: SettlementRow, baseCurrency: string): GroupableSettlement {
  const rates: Record<string, number> = {};
  for (const [cur, v] of Object.entries(s.exchange_rates ?? {})) {
    const n = toNumOrNull(v);
    if (n !== null) rates[cur] = n;
  }
  return {
    id: s.id,
    owner_id: s.owner_id,
    owner_name: s.owner?.full_name ?? "Propietario",
    status: s.status,
    period_year: s.period_year,
    period_month: s.period_month,
    currency: s.currency ?? baseCurrency,
    generated_at: s.generated_at ?? "",
    paid_at: s.paid_at,
    net_payable: toNum(s.net_payable),
    exchange_rates: rates,
    lines: (s.lines ?? []).map((l) => ({
      id: l.id,
      line_type: l.line_type,
      amount: toNum(l.amount),
      sign: l.sign,
      currency: l.currency,
      unit_id: l.unit_id,
      ref_type: l.ref_type,
      ref_id: l.ref_id,
      is_manual: !!l.is_manual,
      meta: toLineMeta(l.meta),
    })),
  };
}

/**
 * Filtro PostgREST exacto para los períodos [from, to] sin `exclude`: un
 * `and(period_year.eq.Y,period_month.gte.a,period_month.lte.b)` por tramo
 * contiguo de cada año. Con `period_year` entre y0 e y1 solamente, la vista de
 * diciembre traería el año entero. `null` si no queda ningún período.
 */
function periodsOrFilter(from: number, to: number, exclude: number): string | null {
  const clauses: string[] = [];
  let run: { year: number; a: number; b: number } | null = null;
  const flush = () => {
    if (run) clauses.push(`and(period_year.eq.${run.year},period_month.gte.${run.a},period_month.lte.${run.b})`);
    run = null;
  };
  for (let idx = from; idx <= to; idx++) {
    if (idx === exclude) {
      flush();
      continue;
    }
    const { year, month } = periodFromIndex(idx);
    if (run && run.year === year && run.b === month - 1) run.b = month;
    else {
      flush();
      run = { year, a: month, b: month };
    }
  }
  flush();
  return clauses.length > 0 ? clauses.join(",") : null;
}

// ── Carga ────────────────────────────────────────────────────────────────────

export interface LoadReconcileParams {
  /** Org activa, ya validada por quien llama. Todas las queries filtran por ella. */
  orgId: string;
  org: ReconcileOrgInput;
  /** Ya acotados por quien llama. */
  year: number;
  month: number;
  mode: ResultsMode;
}

export async function loadReconcileInput(
  admin: AdminClient,
  params: LoadReconcileParams,
): Promise<ReconcileInput> {
  const { orgId, org, year: y, month: m, mode } = params;
  const baseCurrency = org.base_currency;
  const P = periodIndex(y, m);
  const { start, endExclusive } = monthBounds(y, m);

  // ── Ronda 1 ──
  const [q1Rows, unitRows, firstRes, periodRows] = await Promise.all([
    // Q1: reservas con noches (o check-out) en el mes. Fin exclusivo: una
    // temporaria que sale el día 1 del mes siguiente no es de este mes, pero
    // una que sale el día 1 de ESTE mes sí (check_out ≥ start).
    fetchAllPages<BookingRow>(
      (from, to) =>
        admin
          .from("bookings")
          .select(BOOKING_SELECT)
          .eq("organization_id", orgId)
          .eq("is_block", false)
          .in("status", ACTIVE_STATUSES)
          .lt("check_in_date", endExclusive)
          .gte("check_out_date", start)
          .order("id")
          .range(from, to),
      ROWS_PAGE,
    ),
    // Q2
    fetchAllPages<UnitRow>(
      (from, to) =>
        admin.from("units").select(UNIT_SELECT).eq("organization_id", orgId).order("id").range(from, to),
      ROWS_PAGE,
    ),
    // Q7: tope inferior de la ventana y de `historia_incompleta`.
    admin
      .from("owner_settlements")
      .select("period_year, period_month")
      .eq("organization_id", orgId)
      .neq("status", "anulada")
      .order("period_year", { ascending: true })
      .order("period_month", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Q4a: liquidaciones del mes con TODAS sus líneas (puente y otros cargos).
    fetchAllPages<SettlementRow>(
      (from, to) =>
        admin
          .from("owner_settlements")
          .select(SETTLEMENT_SELECT)
          .eq("organization_id", orgId)
          .eq("period_year", y)
          .eq("period_month", m)
          .neq("status", "anulada")
          .order("id")
          .range(from, to),
      SETTLEMENT_PAGE,
    ),
  ]);
  if (firstRes.error) throw new Error(firstRes.error.message);
  const first = firstRes.data as FirstSettlementRow | null;
  const firstSettlementPeriod = first ? periodIndex(first.period_year, first.period_month) : null;

  const bookingsQ1 = q1Rows.map(toBookingInput);
  const units = unitRows.map(toUnitInput);
  const periodDocs = periodRows.map((s) => toGroupable(s, baseCurrency));

  const groupIds = [
    ...new Set(
      bookingsQ1
        .filter((b) => b.mode === "mensual" && b.lease_group_id)
        .map((b) => b.lease_group_id as string),
    ),
  ];
  // Los tramos que tocan el mes ya están en Q1: los cobros extra de la fila
  // salen de esos ids (Q3 sólo agrega tramos de otros meses del contrato).
  const monthBookingIds = bookingsQ1.map((b) => b.id);

  // ── Ronda 2 ──
  const [{ bookings, windowDocs }, extraRows] = await Promise.all([
    (async () => {
      // Q3: los demás tramos de cada contrato mensual.
      const q3Rows = await fetchInChunks<BookingRow>(
        groupIds,
        (chunk, from, to) =>
          admin
            .from("bookings")
            .select(BOOKING_SELECT)
            .eq("organization_id", orgId)
            .eq("is_block", false)
            .in("status", ACTIVE_STATUSES)
            .in("lease_group_id", chunk)
            .order("id")
            .range(from, to),
        ROWS_PAGE,
      );
      const byId = new Map<string, ResultBookingInput>();
      for (const b of bookingsQ1) byId.set(b.id, b);
      for (const r of q3Rows) if (!byId.has(r.id)) byId.set(r.id, toBookingInput(r));
      const merged = [...byId.values()];

      // Q4b: el resto de la ventana, sólo con las líneas de reserva (filtro
      // embebido, no `!inner`: una liquidación sin líneas de reserva igual
      // vuelve, con `lines: []`).
      const win = settlementWindow({ year: y, month: m, org, bookings: merged, firstSettlementPeriod });
      // (y,m) ya vino entero en Q4a: el filtro lo excluye.
      const periodsFilter = periodsOrFilter(win.from, win.to, P);
      if (periodsFilter === null) return { bookings: merged, windowDocs: [] };
      const y0 = periodFromIndex(win.from).year;
      const y1 = periodFromIndex(win.to).year;
      const rows = await fetchAllPages<SettlementRow>(
        (from, to) =>
          admin
            .from("owner_settlements")
            .select(SETTLEMENT_SELECT)
            .eq("organization_id", orgId)
            .neq("status", "anulada")
            .gte("period_year", y0)
            .lte("period_year", y1)
            .or(periodsFilter)
            .eq("lines.ref_type", "booking")
            .order("id")
            .range(from, to),
        SETTLEMENT_PAGE,
      );
      const inWindow = rows.filter((s) => {
        const idx = periodIndex(s.period_year, s.period_month);
        return idx >= win.from && idx <= win.to && idx !== P;
      });
      return { bookings: merged, windowDocs: inWindow.map((s) => toGroupable(s, baseCurrency)) };
    })(),
    // Q6: cobros extra (aparte: no suman a "Paga el huésped").
    fetchInChunks<ExtraChargeRow>(
      monthBookingIds,
      (chunk, from, to) =>
        admin
          .from("cash_movements")
          .select("id, ref_id, amount, currency, billable_to, description, occurred_at")
          .eq("organization_id", orgId)
          .eq("category", "extra_charge")
          .eq("direction", "in")
          .eq("ref_type", "booking")
          .in("ref_id", chunk)
          .order("id")
          .range(from, to),
      ROWS_PAGE,
    ),
  ]);

  const settlements = [...periodDocs, ...windowDocs];
  const extraCharges: ExtraChargeInput[] = extraRows.map((x) => ({
    ref_id: x.ref_id,
    amount: toNum(x.amount),
    currency: x.currency ?? baseCurrency,
    billable_to: x.billable_to,
    description: x.description,
    occurred_at: x.occurred_at,
  }));

  // ── Ronda 3 ──
  const lookups = collectLookups({ year: y, month: m, org, bookings, settlements });

  const rangesByUnit = new Map<string, Array<{ ci: string; co: string }>>();
  for (const s of lookups.synthetic) {
    const arr = rangesByUnit.get(s.unit_id);
    if (arr) arr.push({ ci: s.check_in, co: s.check_out });
    else rangesByUnit.set(s.unit_id, [{ ci: s.check_in, co: s.check_out }]);
  }
  const syntheticUnits = [...rangesByUnit.keys()];
  let minCi = "";
  let maxCo = "";
  for (const s of lookups.synthetic) {
    if (!minCi || s.check_in < minCi) minCi = s.check_in;
    if (!maxCo || s.check_out > maxCo) maxCo = s.check_out;
  }

  const [candidateRows, refRows] = await Promise.all([
    // Q5a: reservas activas de las unidades con filas sintéticas que solapan
    // el rango total; el solape fino contra cada fila se filtra abajo.
    fetchInChunks<BookingRow>(
      syntheticUnits,
      (chunk, from, to) =>
        admin
          .from("bookings")
          .select(BOOKING_SELECT)
          .eq("organization_id", orgId)
          .eq("is_block", false)
          .in("status", ACTIVE_STATUSES)
          .in("unit_id", chunk)
          .lt("check_in_date", maxCo)
          .gt("check_out_date", minCi)
          .order("id")
          .range(from, to),
      ROWS_PAGE,
    ),
    // Q5b: sin filtro de estado — hace falta saber si está cancelada o borrada.
    fetchInChunks<RefLookupRow>(
      lookups.refIds,
      (chunk, from, to) =>
        admin
          .from("bookings")
          .select("id, status, is_block, mode, check_in_date, check_out_date")
          .eq("organization_id", orgId)
          .in("id", chunk)
          .order("id")
          .range(from, to),
      ROWS_PAGE,
    ),
  ]);

  const candidates = candidateRows
    .filter((b) =>
      (rangesByUnit.get(b.unit_id) ?? []).some((r) => b.check_in_date < r.co && b.check_out_date > r.ci),
    )
    .map(toBookingInput);
  const refLookups: RefLookupInput[] = refRows.map((r) => ({
    id: r.id,
    status: r.status,
    is_block: !!r.is_block,
    mode: r.mode ?? "temporario",
    check_in_date: r.check_in_date,
    check_out_date: r.check_out_date,
  }));

  return {
    year: y,
    month: m,
    mode,
    org,
    bookings,
    candidates,
    refLookups,
    units,
    settlements,
    extraCharges,
    firstSettlementPeriod,
  };
}
