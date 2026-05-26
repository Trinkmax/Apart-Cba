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
  gross: number;
  commissionPct: number | null;
  commission: number;
  /** limpieza + expensas + otros descuentos del mismo grupo */
  expenses: number;
  net: number;
}

export interface StatementUnitGroup {
  unit_id: string | null;
  code: string;
  name: string;
  rows: StatementBookingRow[];
  subtotal: { gross: number; commission: number; expenses: number; net: number };
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
  amount: number;
}

export interface StatementModel {
  number: string;
  periodLabel: string;
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
  totals: { gross: number; commission: number; deductions: number; net: number };
  generated_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildStatementModel(s: StatementInput): StatementModel {
  const bookingGroups = new Map<string, StatementLineInput[]>();
  const otros: StatementOtherRow[] = [];

  const otrosWithOrder: Array<{ row: StatementOtherRow; order: number }> = [];

  for (const l of s.lines) {
    if (l.ref_type === "booking" && l.ref_id) {
      const arr = bookingGroups.get(l.ref_id) ?? [];
      arr.push(l);
      bookingGroups.set(l.ref_id, arr);
    } else {
      otrosWithOrder.push({
        row: {
          id: l.id,
          description: l.description,
          line_type: l.line_type,
          unitCode: l.unit?.code ?? null,
          sign: l.sign,
          amount: round2(Number(l.amount)),
        },
        order: Number(l.display_order ?? 0),
      });
    }
  }

  // Orden persistente (display_order ASC). Empate → orden de inserción estable.
  otrosWithOrder.sort((a, b) => a.order - b.order);
  for (const o of otrosWithOrder) otros.push(o.row);

  const unitMap = new Map<string, StatementUnitGroup>();

  for (const [refId, group] of bookingGroups) {
    const revenue =
      group.find(
        (g) =>
          g.sign === "+" &&
          (g.line_type === "booking_revenue" ||
            g.line_type === "monthly_rent_fraction"),
      ) ?? group.find((g) => g.sign === "+");
    const meta = revenue?.meta ?? null;

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
      gross,
      commissionPct: meta?.commission_pct ?? null,
      commission,
      expenses,
      net,
      display_order: groupOrder ?? 0,
    });
  }

  const orderOverride = Array.isArray(s.unit_order) ? s.unit_order : [];
  const orderIndex = new Map<string, number>();
  orderOverride.forEach((uid, i) => orderIndex.set(uid, i));

  const units = Array.from(unitMap.values()).sort((a, b) => {
    const ai = a.unit_id ? orderIndex.get(a.unit_id) : undefined;
    const bi = b.unit_id ? orderIndex.get(b.unit_id) : undefined;
    // Las unidades fuera del override caen al final, ordenadas por code.
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
    ug.subtotal = ug.rows.reduce(
      (acc, r) => ({
        gross: round2(acc.gross + r.gross),
        commission: round2(acc.commission + r.commission),
        expenses: round2(acc.expenses + r.expenses),
        net: round2(acc.net + r.net),
      }),
      { gross: 0, commission: 0, expenses: 0, net: 0 },
    );
  }

  const meta =
    SETTLEMENT_STATUS_META[s.status as keyof typeof SETTLEMENT_STATUS_META] ?? {
      label: s.status,
      color: "#64748b",
    };

  return {
    number: settlementNumber(s.id, s.period_year, s.period_month),
    periodLabel: formatPeriod(s.period_year, s.period_month),
    currency: s.currency,
    status: s.status,
    statusLabel: meta.label,
    statusColor: meta.color,
    owner: {
      full_name: s.owner?.full_name ?? "—",
      bank_name: s.owner?.bank_name ?? null,
      cbu: s.owner?.cbu ?? null,
      alias_cbu: s.owner?.alias_cbu ?? null,
    },
    units,
    otros,
    totals: {
      gross: round2(Number(s.gross_revenue)),
      commission: round2(Number(s.commission_amount)),
      deductions: round2(Number(s.deductions_amount)),
      net: round2(Number(s.net_payable)),
    },
    generated_at: s.generated_at ?? null,
    sent_at: s.sent_at ?? null,
    paid_at: s.paid_at ?? null,
  };
}
