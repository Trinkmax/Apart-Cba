import type { SettlementLine, SettlementLineMeta } from "@/lib/types/database";
import { formatPeriod, settlementNumber, SETTLEMENT_STATUS_META } from "./labels";

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

export interface StatementUnitGroup {
  unit_id: string | null;
  code: string;
  name: string;
  rows: StatementBookingRow[];
  /** Subtotales convertidos a moneda base. */
  subtotal: { gross: number; commission: number; expenses: number; net: number };
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
  periodLabel: string;
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
  /** Totales SIEMPRE en moneda base (ARS) — equivalentes a los persistidos. */
  totals: { gross: number; commission: number; deductions: number; net: number };
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
    const expenses = round2(
      group
        .filter((g) => g.sign === "-" && g.line_type !== "commission")
        .reduce((acc, g) => acc + Number(g.amount), 0),
    );
    const net = round2(gross - commission - expenses);
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
        rows: [],
        subtotal: { gross: 0, commission: 0, expenses: 0, net: 0 },
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
        const expConv = convert(
          r.expenses,
          r.currency,
          baseCurrency,
          exchangeRates,
        );
        return {
          gross: round2(acc.gross + grossConv.value),
          commission: round2(acc.commission + commConv.value),
          expenses: round2(acc.expenses + expConv.value),
          net: round2(acc.net + r.netInBase),
        };
      },
      { gross: 0, commission: 0, expenses: 0, net: 0 },
    );
    ug.currencies = Array.from(currencySet).sort();
  }

  // Totales del documento: sumamos en base. La regla es la misma que en el
  // backend (`computeTotals` con conversion), así que matchean los valores
  // persistidos en `owner_settlements.{gross_revenue,commission_amount,...}`.
  // Pero recalculamos en cliente para reflejar instantáneamente cambios de TC
  // antes de persistir (la UI puede previsualizar).
  const totals = (() => {
    let gross = 0;
    let commission = 0;
    let deductions = 0;
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
      deductions: round2(deductions),
      net: round2(net),
    };
  })();

  const statusMeta =
    SETTLEMENT_STATUS_META[s.status as keyof typeof SETTLEMENT_STATUS_META] ?? {
      label: s.status,
      color: "#64748b",
    };

  return {
    number: settlementNumber(s.id, s.period_year, s.period_month),
    periodLabel: formatPeriod(s.period_year, s.period_month),
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
    exchangeRates,
    foreignCurrencies: Array.from(foreignCurrenciesSet).sort(),
    missingRates: Array.from(missingRatesSet).sort(),
    generated_at: s.generated_at ?? null,
    sent_at: s.sent_at ?? null,
    paid_at: s.paid_at ?? null,
  };
}
