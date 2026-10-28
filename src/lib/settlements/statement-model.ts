import type { SettlementLine, SettlementLineMeta } from "@/lib/types/database";
import {
  formatPeriod,
  formatPeriodCycle,
  formatPeriodCycleShort,
  parseUnitPeriods,
  PER_UNIT_PERIOD_LABEL,
  settlementNumber,
  SETTLEMENT_STATUS_META,
  type UnitPeriods,
} from "./labels";

/**
 * Pivotea las settlement_lines planas a la "planilla clásica por unidad":
 * un bloque por unidad, una fila por reserva (agrupando revenue+comisión+
 * gastos por ref_id), subtotal por unidad, y "Otros cargos" para
 * mantenimiento / ajustes manuales sin reserva.
 *
 * Lo consumen el Excel, el PDF y la pantalla — una sola fuente de verdad de
 * la estructura del documento.
 *
 * Multi-moneda (migración 027): cada `StatementLineInput` lleva su `currency`
 * (nativa). Los subtotales por unidad y los totales del documento se calculan
 * en la moneda base (`StatementInput.currency`, default ARS) usando
 * `exchange_rates` para convertir las líneas que no estén en base. Las filas
 * individuales conservan su moneda original para mostrarlas en su denominación
 * y agregar al lado el equivalente en base.
 */

export interface StatementLineInput {
  id: string;
  line_type: SettlementLine["line_type"];
  ref_type: string | null;
  ref_id: string | null;
  unit_id: string | null;
  description: string;
  amount: number;
  sign: "+" | "-";
  /** Moneda nativa de la línea (default = base si la BD trae null/legacy). */
  currency?: string | null;
  is_manual?: boolean | null;
  meta?: SettlementLineMeta | null;
  /**
   * Posición persistida para reordenamiento manual. Las 3 líneas de un mismo
   * booking (ingreso + comisión + gastos) llevan offsets consecutivos sobre
   * el mismo "base". Para ordenar bookings dentro de una unidad usamos el
   * `min(display_order)` del grupo.
   */
  display_order?: number | null;
  unit?: { id: string; code: string; name: string } | null;
}

export interface StatementInput {
  id: string;
  period_year: number;
  period_month: number;
  /** Posición dentro del ciclo de ajuste por IPC (migración 046). */
  period_index?: number | null;
  /** Largo del ciclo de ajuste en meses (3 = trimestral). */
  period_cycle?: number | null;
  /** Aclaración corta del período, impresa en el documento. */
  period_note?: string | null;
  /**
   * Período por departamento (migración 074): `unit_id → {index, cycle}`. Se
   * excluye con `period_index` — o uno para todo el documento, o uno por
   * unidad. Una unidad del documento sin entrada = "no aplica".
   */
  unit_periods?: UnitPeriods | null;
  status: string;
  /** Moneda BASE del documento (ARS por default). */
  currency: string;
  gross_revenue: number;
  commission_amount: number;
  deductions_amount: number;
  net_payable: number;
  generated_at?: string | null;
  sent_at?: string | null;
  paid_at?: string | null;
  owner: {
    full_name: string;
    bank_name?: string | null;
    cbu?: string | null;
    alias_cbu?: string | null;
  } | null;
  /** Override del orden de unidades del documento. [] → orden alfabético. */
  unit_order?: string[] | null;
  /**
   * Tasas de cambio contra la moneda base. Formato: `{ "USD": 1300, ... }`.
   * Las líneas en monedas sin tasa cuentan como 0 al sumar el total.
   */
  exchange_rates?: Record<string, number> | null;
  lines: StatementLineInput[];
}

export interface StatementBookingRow {
  ref_id: string | null;
  check_in: string | null;
  check_out: string | null;
  guest: string;
  nights: number | null;
  source: string | null;
  mode: "temporario" | "mensual" | null;
  /** Moneda nativa del grupo (de la línea de revenue). */
  currency: string;
  /** Importes en moneda NATIVA. */
  gross: number;
  commissionPct: number | null;
  commission: number;
  /**
   * Comisión de la plataforma (Booking, Airbnb…) — línea `channel_commission`
   * (migración 058). Va en su propia columna, NO dentro de `expenses`.
   */
  channelCommission: number;
  /** Sobre qué base se calculó `commission` (snapshot del meta; null en docs viejos). */
  commissionBase: "gross" | "net_of_channel" | null;
  /** limpieza + expensas + otros descuentos del mismo grupo */
  expenses: number;
  net: number;
  /**
   * Mismo `net` pero convertido a moneda base (`StatementInput.currency`).
   * Si la línea ya está en base, es igual al `net`. Si falta TC, es 0.
   */
  netInBase: number;
  /** true si la moneda nativa difiere de la base. UI muestra "≈ ARS X" aparte. */
  needsConversion: boolean;
  /** true si la moneda nativa NO es base Y NO hay TC cargado. UI: warning. */
  missingRate: boolean;
}

/** Período del ciclo de una unidad, ya rotulado (migración 074). */
export interface StatementUnitPeriod {
  index: number;
  cycle: number | null;
  /** "Período 2/3" */
  label: string;
  /** "2/3" — para listas con el código adelante ("DF-1 2/3"). */
  short: string;
}

export interface StatementUnitGroup {
  unit_id: string | null;
  code: string;
  name: string;
  /**
   * Período de ESTA unidad cuando el documento va por departamento. `null` en
   * los otros modos o si a la unidad no le aplica ese mes.
   */
  period: StatementUnitPeriod | null;
  rows: StatementBookingRow[];
  /** Subtotales convertidos a moneda base. */
  subtotal: {
    gross: number;
    commission: number;
    channelCommission: number;
    expenses: number;
    net: number;
  };
  /** Monedas distintas presentes en las reservas de esta unidad. */
  currencies: string[];
}

/** Cada fila de "Reservas" lleva el order del grupo para el drag-and-drop. */
export interface StatementBookingRowWithOrder extends StatementBookingRow {
  /** min(display_order) de las 3 líneas del grupo. Determina la posición. */
  display_order: number;
}

export interface StatementOtherRow {
  /** id de la settlement_line — necesario para editar/eliminar desde la UI. */
  id: string;
  description: string;
  line_type: SettlementLine["line_type"];
  unitCode: string | null;
  sign: "+" | "-";
  /** Moneda nativa del cargo. */
  currency: string;
  /** Importe en moneda NATIVA. */
  amount: number;
  /** Mismo importe convertido a base. 0 si falta TC. */
  amountInBase: number;
  needsConversion: boolean;
  missingRate: boolean;
}

export interface StatementModel {
  number: string;
  /** "Julio 2026" — el mes calendario liquidado. */
  periodLabel: string;
  /**
   * Cómo se cargó el período: uno para todo el documento (046), uno por
   * departamento (074) o ninguno.
   */
  periodMode: "none" | "uniform" | "per_unit";
  /**
   * "Período 1/3" — cuando TODO el documento está en el mismo punto del ciclo:
   * modo uniforme, o por depto con todas sus unidades en el mismo período.
   * `null` si no hay período o si los deptos están en períodos distintos.
   */
  periodCycleLabel: string | null;
  /**
   * Lo que va en el chip del encabezado: `periodCycleLabel` o, si los deptos
   * difieren, "Período por departamento". `null` = no hay nada que mostrar.
   */
  periodBadgeLabel: string | null;
  /** Valores crudos del período uniforme, para el editor del encabezado. */
  periodIndex: number | null;
  periodCycle: number | null;
  /**
   * Modo por depto: las unidades del documento QUE TIENEN período, en el orden
   * del documento. Vacío en los otros modos.
   */
  unitPeriods: Array<
    { unit_id: string; code: string; name: string } & StatementUnitPeriod
  >;
  /**
   * "Julio 2026 · Período 1/3" — lo que va en títulos, asunto de email, etc.
   * Con deptos en períodos distintos queda sólo el mes: el detalle va aparte.
   */
  periodFullLabel: string;
  /** Aclaración corta opcional del período. */
  periodNote: string | null;
  /** Moneda base del documento (en la que se totaliza). */
  currency: string;
  status: string;
  statusLabel: string;
  statusColor: string;
  owner: {
    full_name: string;
    bank_name: string | null;
    cbu: string | null;
    alias_cbu: string | null;
  };
  units: StatementUnitGroup[];
  otros: StatementOtherRow[];
  /**
   * Totales SIEMPRE en moneda base (ARS). `gross`, `commission` y `net` son
   * los persistidos; `deductions` acá EXCLUYE la comisión del canal (que va en
   * `channelCommission`) y lo cobrado por el propietario (`ownerCollected`),
   * mientras que `owner_settlements.deductions_amount` incluye las dos cosas
   * porque no tienen columna propia. deductions + channelCommission +
   * ownerCollected = deductions_amount.
   */
  totals: {
    gross: number;
    commission: number;
    channelCommission: number;
    deductions: number;
    /** Líneas `owner_collected`: plata que el propietario ya tiene en la mano (077). */
    ownerCollected: number;
    /**
     * Lo que ganó el propietario en el período: bruto − canal − comisión −
     * gastos = net + ownerCollected. Sólo difiere del neto si cobró él.
     */
    ownerEarnings: number;
    net: number;
  };
  /**
   * true si alguna línea del documento tiene comisión del canal > 0. Las
   * pantallas, el PDF y el Excel muestran la columna "Canal" SÓLO en ese caso,
   * así los documentos anteriores a la migración 058 se ven idénticos.
   */
  hasChannelCommission: boolean;
  /** Tasas de cambio activas del documento. */
  exchangeRates: Record<string, number>;
  /** Monedas distintas detectadas en las líneas (sin la base). */
  foreignCurrencies: string[];
  /** Monedas que aparecen en líneas pero NO tienen TC cargado. */
  missingRates: string[];
  generated_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function convert(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  rates: Record<string, number>,
): { value: number; needs: boolean; missing: boolean } {
  if (fromCurrency === baseCurrency) {
    return { value: amount, needs: false, missing: false };
  }
  const rate = Number(rates?.[fromCurrency] ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { value: 0, needs: true, missing: true };
  }
  return { value: round2(amount * rate), needs: true, missing: false };
}

export function buildStatementModel(s: StatementInput): StatementModel {
  const baseCurrency = s.currency;
  const exchangeRates: Record<string, number> = s.exchange_rates ?? {};

  const bookingGroups = new Map<string, StatementLineInput[]>();
  const otros: StatementOtherRow[] = [];

  const otrosWithOrder: Array<{ row: StatementOtherRow; order: number }> = [];

  for (const l of s.lines) {
    if (l.ref_type === "booking" && l.ref_id) {
      const arr = bookingGroups.get(l.ref_id) ?? [];
      arr.push(l);
      bookingGroups.set(l.ref_id, arr);
    } else {
      const lineCurrency = l.currency ?? baseCurrency;
      const amountNative = round2(Number(l.amount));
      const conv = convert(amountNative, lineCurrency, baseCurrency, exchangeRates);
      otrosWithOrder.push({
        row: {
          id: l.id,
          description: l.description,
          line_type: l.line_type,
          unitCode: l.unit?.code ?? null,
          sign: l.sign,
          currency: lineCurrency,
          amount: amountNative,
          amountInBase: conv.value,
          needsConversion: conv.needs,
          missingRate: conv.missing,
        },
        order: Number(l.display_order ?? 0),
      });
    }
  }

  // Orden persistente (display_order ASC). Empate → orden de inserción estable.
  otrosWithOrder.sort((a, b) => a.order - b.order);
  for (const o of otrosWithOrder) otros.push(o.row);

  const unitMap = new Map<string, StatementUnitGroup>();
  const foreignCurrenciesSet = new Set<string>();
  const missingRatesSet = new Set<string>();

  for (const [refId, group] of bookingGroups) {
    const revenue =
      group.find(
        (g) =>
          g.sign === "+" &&
          (g.line_type === "booking_revenue" ||
            g.line_type === "monthly_rent_fraction"),
      ) ?? group.find((g) => g.sign === "+");
    const meta = revenue?.meta ?? null;
    // Tomamos la moneda del revenue como representativa del grupo. En la
    // práctica todas las líneas del grupo viven en la misma moneda (la del
    // booking), pero por seguridad caemos a la primera con currency definido.
    const rowCurrency =
      revenue?.currency ?? group.find((g) => g.currency)?.currency ?? baseCurrency;

    const gross = round2(
      group.filter((g) => g.sign === "+").reduce((acc, g) => acc + Number(g.amount), 0),
    );
    const commission = round2(
      group
        .filter((g) => g.line_type === "commission")
        .reduce((acc, g) => acc + Number(g.amount), 0),
    );
    const channelCommission = round2(
      group
        .filter((g) => g.line_type === "channel_commission")
        .reduce((acc, g) => acc + Number(g.amount), 0),
    );
    const expenses = round2(
      group
        .filter(
          (g) =>
            g.sign === "-" &&
            g.line_type !== "commission" &&
            g.line_type !== "channel_commission",
        )
        .reduce((acc, g) => acc + Number(g.amount), 0),
    );
    const net = round2(gross - commission - channelCommission - expenses);
    const netConv = convert(net, rowCurrency, baseCurrency, exchangeRates);
    if (rowCurrency !== baseCurrency) foreignCurrenciesSet.add(rowCurrency);
    if (netConv.missing) missingRatesSet.add(rowCurrency);

    const u = revenue?.unit ?? group[0]?.unit ?? null;
    const k = (revenue ?? group[0]).unit_id ?? "__none__";
    let ug = unitMap.get(k);
    if (!ug) {
      ug = {
        unit_id: u?.id ?? null,
        code: u?.code ?? "—",
        name: u?.name ?? "Sin unidad",
        period: null,
        rows: [],
        subtotal: {
          gross: 0,
          commission: 0,
          channelCommission: 0,
          expenses: 0,
          net: 0,
        },
        currencies: [],
      };
      unitMap.set(k, ug);
    }
    // min(display_order) del grupo determina la posición del booking dentro
    // de su unidad. Si ningún line trae order, queda 0 y caemos a check_in.
    const groupOrder = group.reduce<number | null>((acc, g) => {
      const o = Number(g.display_order ?? Number.NaN);
      if (!Number.isFinite(o)) return acc;
      return acc == null || o < acc ? o : acc;
    }, null);
    (ug.rows as StatementBookingRowWithOrder[]).push({
      ref_id: refId,
      check_in: meta?.check_in ?? null,
      check_out: meta?.check_out ?? null,
      guest: meta?.guest_name ?? "—",
      nights: meta?.nights ?? null,
      source: meta?.source ?? null,
      mode: meta?.mode ?? null,
      currency: rowCurrency,
      gross,
      commissionPct: meta?.commission_pct ?? null,
      commission,
      channelCommission,
      commissionBase: meta?.commission_base ?? null,
      expenses,
      net,
      netInBase: netConv.value,
      needsConversion: netConv.needs,
      missingRate: netConv.missing,
      display_order: groupOrder ?? 0,
    });
  }

  // Marcamos también las monedas de "otros cargos" para el aviso global.
  for (const o of otros) {
    if (o.currency !== baseCurrency) foreignCurrenciesSet.add(o.currency);
    if (o.missingRate) missingRatesSet.add(o.currency);
  }

  const orderOverride = Array.isArray(s.unit_order) ? s.unit_order : [];
  const orderIndex = new Map<string, number>();
  orderOverride.forEach((uid, i) => orderIndex.set(uid, i));

  const units = Array.from(unitMap.values()).sort((a, b) => {
    const ai = a.unit_id ? orderIndex.get(a.unit_id) : undefined;
    const bi = b.unit_id ? orderIndex.get(b.unit_id) : undefined;
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.code.localeCompare(b.code);
  });
  for (const ug of units) {
    (ug.rows as StatementBookingRowWithOrder[]).sort((a, b) => {
      if (a.display_order !== b.display_order)
        return a.display_order - b.display_order;
      return (a.check_in ?? "").localeCompare(b.check_in ?? "");
    });
    const currencySet = new Set<string>();
    ug.subtotal = ug.rows.reduce(
      (acc, r) => {
        currencySet.add(r.currency);
        // Convertimos cada componente del subtotal a base. Si la moneda es la
        // base, las funciones convert() devuelven los mismos valores.
        const grossConv = convert(r.gross, r.currency, baseCurrency, exchangeRates);
        const commConv = convert(
          r.commission,
          r.currency,
          baseCurrency,
          exchangeRates,
        );
        const chanConv = convert(
          r.channelCommission,
          r.currency,
          baseCurrency,
          exchangeRates,
        );
        const expConv = convert(
          r.expenses,
          r.currency,
          baseCurrency,
          exchangeRates,
        );
        return {
          gross: round2(acc.gross + grossConv.value),
          commission: round2(acc.commission + commConv.value),
          channelCommission: round2(acc.channelCommission + chanConv.value),
          expenses: round2(acc.expenses + expConv.value),
          net: round2(acc.net + r.netInBase),
        };
      },
      { gross: 0, commission: 0, channelCommission: 0, expenses: 0, net: 0 },
    );
    ug.currencies = Array.from(currencySet).sort();
  }

  // ── Período del ciclo de ajuste (046 uniforme / 074 por depto) ───────────
  // La base no admite los dos a la vez; si igual llegaran, gana el uniforme,
  // que es el que se ve en el encabezado.
  const uniformLabel = formatPeriodCycle(s.period_index, s.period_cycle);
  const byUnit = uniformLabel ? {} : parseUnitPeriods(s.unit_periods);
  const periodMode: StatementModel["periodMode"] = uniformLabel
    ? "uniform"
    : Object.keys(byUnit).length > 0
      ? "per_unit"
      : "none";
  if (periodMode === "per_unit") {
    for (const ug of units) {
      const p = ug.unit_id ? byUnit[ug.unit_id.toLowerCase()] : undefined;
      ug.period = p
        ? {
            index: p.index,
            cycle: p.cycle,
            label: formatPeriodCycle(p.index, p.cycle)!,
            short: formatPeriodCycleShort(p.index, p.cycle)!,
          }
        : null;
    }
  }
  // Códigos y nombres recortados: en la base hay "DF-1    " y estas listas van
  // en una línea ("DF-1 2/3 · DF-2 3/3"), donde los espacios sí se ven.
  const unitPeriods = units.flatMap((ug) =>
    ug.unit_id && ug.period
      ? [
          {
            unit_id: ug.unit_id,
            code: ug.code.trim(),
            name: ug.name.trim(),
            ...ug.period,
          },
        ]
      : [],
  );
  // Por depto, el documento entero tiene UN período sólo si todas sus unidades
  // lo tienen y coinciden. Con una que "no aplica" ya no se puede decir que el
  // documento es "Período 2/3": va el detalle por unidad.
  const unitsWithId = units.filter((ug) => ug.unit_id);
  const sharedUnitLabel =
    unitPeriods.length > 0 &&
    unitPeriods.length === unitsWithId.length &&
    unitPeriods.every((p) => p.label === unitPeriods[0].label)
      ? unitPeriods[0].label
      : null;
  const periodCycleLabel = uniformLabel ?? sharedUnitLabel;
  const periodBadgeLabel =
    periodCycleLabel ?? (unitPeriods.length > 0 ? PER_UNIT_PERIOD_LABEL : null);
  const periodLabel = formatPeriod(s.period_year, s.period_month);

  // Totales del documento: sumamos en base. La regla es la misma que en el
  // backend (`computeTotals` con conversion), así que matchean los valores
  // persistidos en `owner_settlements.{gross_revenue,commission_amount,...}`.
  // Pero recalculamos en cliente para reflejar instantáneamente cambios de TC
  // antes de persistir (la UI puede previsualizar).
  const totals = (() => {
    let gross = 0;
    let commission = 0;
    let channelCommission = 0;
    let deductions = 0;
    let ownerCollected = 0;
    let net = 0;
    const pushLine = (
      amount: number,
      currency: string,
      sign: "+" | "-",
      lineType: SettlementLine["line_type"],
    ) => {
      const c = convert(amount, currency, baseCurrency, exchangeRates).value;
      if (sign === "+") {
        gross += c;
        net += c;
      } else {
        net -= c;
        if (lineType === "commission") commission += c;
        else if (lineType === "channel_commission") channelCommission += c;
        else if (lineType === "owner_collected") ownerCollected += c;
        else deductions += c;
      }
    };
    for (const l of s.lines) {
      pushLine(
        Number(l.amount),
        l.currency ?? baseCurrency,
        l.sign,
        l.line_type,
      );
    }
    return {
      gross: round2(gross),
      commission: round2(commission),
      channelCommission: round2(channelCommission),
      deductions: round2(deductions),
      ownerCollected: round2(ownerCollected),
      ownerEarnings: round2(net + ownerCollected),
      net: round2(net),
    };
  })();

  // La columna "Canal" aparece sólo si hay algo que mostrar. Miramos también
  // las filas en moneda nativa: una reserva en USD sin TC convierte a 0 y no
  // sumaría al total, pero su comisión del canal sigue existiendo.
  const hasChannelCommission =
    totals.channelCommission > 0 ||
    units.some((u) => u.rows.some((r) => r.channelCommission > 0)) ||
    otros.some((o) => o.line_type === "channel_commission" && o.amount > 0);

  const statusMeta =
    SETTLEMENT_STATUS_META[s.status as keyof typeof SETTLEMENT_STATUS_META] ?? {
      label: s.status,
      color: "#64748b",
    };

  return {
    number: settlementNumber(s.id, s.period_year, s.period_month),
    periodLabel,
    periodMode,
    periodCycleLabel,
    periodBadgeLabel,
    periodIndex: uniformLabel ? (s.period_index ?? null) : null,
    periodCycle: uniformLabel ? (s.period_cycle ?? null) : null,
    unitPeriods,
    periodFullLabel: periodCycleLabel
      ? `${periodLabel} · ${periodCycleLabel}`
      : periodLabel,
    periodNote: s.period_note?.trim() ? s.period_note.trim() : null,
    currency: baseCurrency,
    status: s.status,
    statusLabel: statusMeta.label,
    statusColor: statusMeta.color,
    owner: {
      full_name: s.owner?.full_name ?? "—",
      bank_name: s.owner?.bank_name ?? null,
      cbu: s.owner?.cbu ?? null,
      alias_cbu: s.owner?.alias_cbu ?? null,
    },
    units,
    otros,
    totals,
    hasChannelCommission,
    exchangeRates,
    foreignCurrencies: Array.from(foreignCurrenciesSet).sort(),
    missingRates: Array.from(missingRatesSet).sort(),
    generated_at: s.generated_at ?? null,
    sent_at: s.sent_at ?? null,
    paid_at: s.paid_at ?? null,
  };
}

/**
 * Fila de `owner_settlements` con su propietario y sus líneas, tal como la
 * traen los selects del detalle, el link público y el envío por mail
 * (`*, owner:owners(…), lines:settlement_lines(*, unit:units(id, code, name))`).
 */
export interface StatementRecord {
  id: string;
  period_year: number;
  period_month: number;
  period_index?: number | null;
  period_cycle?: number | null;
  period_note?: string | null;
  unit_periods?: unknown;
  status: string;
  currency: string;
  gross_revenue: number | string;
  commission_amount: number | string;
  deductions_amount: number | string;
  net_payable: number | string;
  generated_at?: string | null;
  sent_at?: string | null;
  paid_at?: string | null;
  unit_order?: unknown;
  exchange_rates?: unknown;
  owner?: {
    full_name: string;
    bank_name?: string | null;
    cbu?: string | null;
    alias_cbu?: string | null;
  } | null;
  lines?: Array<{
    id: string;
    line_type: SettlementLine["line_type"];
    ref_type: string | null;
    ref_id: string | null;
    unit_id: string | null;
    description: string;
    amount: number | string;
    sign: "+" | "-";
    currency?: string | null;
    is_manual?: boolean | null;
    meta?: SettlementLineMeta | null;
    display_order?: number | null;
    unit?: { id: string; code: string; name: string } | null;
  }> | null;
}

/**
 * Arma el `StatementInput` desde la fila de la base. Una sola traducción para
 * el detalle, el link público y el mail: cuando cada uno armaba la suya, el
 * mail se olvidaba del orden de unidades y de los tipos de cambio (el PDF que
 * recibía el propietario sumaba distinto que la pantalla).
 */
export function statementInputFromRecord(r: StatementRecord): StatementInput {
  const rates: Record<string, number> = {};
  if (r.exchange_rates && typeof r.exchange_rates === "object") {
    for (const [ccy, rate] of Object.entries(
      r.exchange_rates as Record<string, unknown>,
    )) {
      const n = Number(rate);
      if (Number.isFinite(n) && n > 0) rates[ccy] = n;
    }
  }
  return {
    id: r.id,
    period_year: r.period_year,
    period_month: r.period_month,
    period_index: r.period_index ?? null,
    period_cycle: r.period_cycle ?? null,
    period_note: r.period_note ?? null,
    unit_periods: parseUnitPeriods(r.unit_periods),
    status: r.status,
    currency: r.currency,
    gross_revenue: Number(r.gross_revenue),
    commission_amount: Number(r.commission_amount),
    deductions_amount: Number(r.deductions_amount),
    net_payable: Number(r.net_payable),
    generated_at: r.generated_at ?? null,
    sent_at: r.sent_at ?? null,
    paid_at: r.paid_at ?? null,
    owner: r.owner
      ? {
          full_name: r.owner.full_name,
          bank_name: r.owner.bank_name ?? null,
          cbu: r.owner.cbu ?? null,
          alias_cbu: r.owner.alias_cbu ?? null,
        }
      : null,
    unit_order: Array.isArray(r.unit_order)
      ? r.unit_order.filter((u): u is string => typeof u === "string")
      : [],
    exchange_rates: rates,
    lines: (r.lines ?? []).map((l) => ({
      id: l.id,
      line_type: l.line_type,
      ref_type: l.ref_type,
      ref_id: l.ref_id,
      unit_id: l.unit_id,
      description: l.description,
      amount: Number(l.amount),
      sign: l.sign,
      currency: l.currency ?? null,
      is_manual: l.is_manual ?? null,
      meta: l.meta ?? null,
      display_order: l.display_order ?? null,
      unit: l.unit ?? null,
    })),
  };
}
