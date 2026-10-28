import type { SettlementStatus, SettlementLine } from "@/lib/types/database";

/**
 * Fuente única de verdad para labels/colores/period de liquidaciones.
 * Antes estaba duplicado en page.tsx, [id]/page.tsx y settlement-pdf.ts.
 */

export const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

/** "Mayo 2026" */
export function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? "?"} ${year}`;
}

/**
 * Ciclo de ajuste por IPC (migración 046). En AR el alquiler se actualiza cada
 * N meses; cada mes del ciclo es un "período" y el propietario necesita ver
 * cuál se le está pagando (después del último, el precio cambia).
 *
 *   (1, 3) → "Período 1/3"     (2, null) → "Período 2"     (null, _) → null
 */
export function formatPeriodCycle(
  index?: number | null,
  cycle?: number | null,
): string | null {
  if (!index || index < 1) return null;
  return cycle && cycle > 0 ? `Período ${index}/${cycle}` : `Período ${index}`;
}

/** "Julio 2026 · Período 1/3" — cae a "Julio 2026" si no hay período cargado. */
export function formatPeriodFull(
  year: number,
  month: number,
  index?: number | null,
  cycle?: number | null,
): string {
  const base = formatPeriod(year, month);
  const suffix = formatPeriodCycle(index, cycle);
  return suffix ? `${base} · ${suffix}` : base;
}

/**
 * Ciclo por defecto al cargar un período por primera vez: la Ley de Alquileres
 * y la práctica de mercado ajustan trimestralmente.
 */
export const DEFAULT_PERIOD_CYCLE = 3;

/** Largos de ciclo ofrecidos como atajo en la UI (además de "otro"). */
export const PERIOD_CYCLE_PRESETS = [3, 4, 6, 12] as const;

/** Tope duro del ciclo — espejo del CHECK `owner_settlements_period_cycle_valid`. */
export const MAX_PERIOD_CYCLE = 36;

/** Tope de la nota — espejo del CHECK `owner_settlements_period_note_len`. */
export const MAX_PERIOD_NOTE_LENGTH = 160;

/**
 * Período que corresponde `steps` meses después de `index`. Al pasar el último
 * del ciclo vuelve a 1, porque ahí se aplica el ajuste por IPC y arranca un
 * ciclo nuevo.
 *
 * `steps` importa: si el propietario no tuvo liquidación en agosto, la de
 * septiembre no es la que sigue a julio sino la de dos meses después.
 * Sin ciclo cargado no hay vuelta posible, así que sólo suma.
 */
export function nextPeriodInCycle(
  index: number,
  cycle: number | null,
  steps = 1,
): number {
  const jump = Math.max(1, Math.trunc(steps));
  if (!cycle || cycle < 1) return index + jump;
  // 0-based para que el módulo cierre el ciclo, y de vuelta a 1-based.
  return ((index - 1 + jump) % cycle) + 1;
}

// ── Período por departamento (migración 074) ────────────────────────────────
//
// Un propietario con varios deptos tiene cada contrato en un punto distinto del
// ciclo: "DF-1 · Período 2/3", "DF-2 · Período 3/3". Se guarda en
// `owner_settlements.unit_periods` y se excluye con `period_index`: o hay un
// período para todo el documento, o uno por unidad. Una unidad sin entrada =
// "no aplica" ese mes.

/** Período de UNA unidad: misma idea que `period_index` / `period_cycle`. */
export interface UnitPeriod {
  index: number;
  cycle: number | null;
}

/** `unit_id → período`: lo que guarda `owner_settlements.unit_periods`. */
export type UnitPeriods = Record<string, UnitPeriod>;

/** Tope de entradas — espejo del CHECK `owner_settlements_unit_periods_valid`. */
export const MAX_UNIT_PERIODS = 200;

/**
 * Lo que dice el encabezado cuando los deptos están en períodos distintos: el
 * detalle de cada uno va en su bloque. "Departamento" porque es la palabra con
 * la que lo pidieron (ver docs del pedido en la migración 074).
 */
export const PER_UNIT_PERIOD_LABEL = "Período por departamento";

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Entero 1..36, `null` si no vino, `undefined` si vino algo inválido. */
function periodInt(v: unknown): number | null | undefined {
  if (v == null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PERIOD_CYCLE
    ? v
    : undefined;
}

/**
 * Lee `unit_periods` tal como sale de la base (jsonb → unknown) y descarta las
 * entradas que no cumplan el contrato de la 074. La base ya las valida con un
 * CHECK; esto es para que un JSON inesperado nunca rompa el documento.
 */
export function parseUnitPeriods(raw: unknown): UnitPeriods {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: UnitPeriods = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.toLowerCase();
    if (!UUID_KEY.test(id) || !value || typeof value !== "object") continue;
    const v = value as { index?: unknown; cycle?: unknown };
    const index = periodInt(v.index);
    const cycle = periodInt(v.cycle);
    if (index == null || cycle === undefined) continue;
    if (cycle != null && index > cycle) continue;
    out[id] = { index, cycle };
  }
  return out;
}

/** true si el documento tiene al menos un período por departamento. */
export function hasUnitPeriods(raw: unknown): boolean {
  return Object.keys(parseUnitPeriods(raw)).length > 0;
}

/**
 * "2/3" — para listas que ya llevan el código de la unidad adelante
 * ("DF-1 2/3"). Sin ciclo: "período 2", porque un "2" suelto no se entiende.
 */
export function formatPeriodCycleShort(
  index?: number | null,
  cycle?: number | null,
): string | null {
  if (!index || index < 1) return null;
  return cycle && cycle > 0 ? `${index}/${cycle}` : `período ${index}`;
}

/** Los períodos distintos, ordenados por mes del ciclo y después por largo. */
function distinctUnitPeriods(periods: UnitPeriods): UnitPeriod[] {
  const distinct = new Map<string, UnitPeriod>();
  for (const p of Object.values(periods)) {
    distinct.set(`${p.index}/${p.cycle ?? ""}`, p);
  }
  return Array.from(distinct.values()).sort(
    (a, b) => a.index - b.index || (a.cycle ?? 0) - (b.cycle ?? 0),
  );
}

/**
 * Resumen para listados que NO tienen los códigos de las unidades: "Período
 * 2/3" si todos los deptos coinciden, "Por depto · 1/3 · 2/3" si no.
 */
export function summarizeUnitPeriods(periods: UnitPeriods): string | null {
  const list = distinctUnitPeriods(periods);
  if (list.length === 0) return null;
  if (list.length === 1) return formatPeriodCycle(list[0].index, list[0].cycle);
  return `Por depto · ${list
    .map((p) => formatPeriodCycleShort(p.index, p.cycle))
    .join(" · ")}`;
}

/**
 * El período de un documento en una línea, para lo que vive fuera del
 * documento (egreso de Caja, historial, avisos): "Período 1/3" o, por depto,
 * "DF-1 2/3 · DF-2 3/3" (si todos coinciden, "Período 2/3"). Con `codes`
 * (unit_id → código) nombra las unidades; sin ellos, o si no encuentra
 * ninguna, cae al resumen sin nombres. `null` = sin período.
 */
export function describeSettlementPeriod(
  s: {
    period_index?: number | null;
    period_cycle?: number | null;
    unit_periods?: unknown;
  },
  codes?: ReadonlyMap<string, string>,
): string | null {
  const uniform = formatPeriodCycle(s.period_index, s.period_cycle);
  if (uniform) return uniform;
  const periods = parseUnitPeriods(s.unit_periods);
  // Todos en el mismo período (o ninguno): una sola etiqueta lo dice todo.
  if (distinctUnitPeriods(periods).length <= 1) {
    return summarizeUnitPeriods(periods);
  }
  const named = Object.entries(periods)
    .map(([id, p]) => ({ code: codes?.get(id)?.trim(), p }))
    .filter((e): e is { code: string; p: UnitPeriod } => !!e.code)
    .sort((a, b) =>
      a.code.localeCompare(b.code, "es", { numeric: true, sensitivity: "base" }),
    );
  if (named.length === 0) return summarizeUnitPeriods(periods);
  return named
    .map((e) => `${e.code} ${formatPeriodCycleShort(e.p.index, e.p.cycle)}`)
    .join(" · ");
}

/** Lo que propone "seguir el ciclo" en la liquidación siguiente. */
export interface PeriodSuggestion {
  /** De dónde sale: "Septiembre 2026 · Período 1/3" o "… · por departamento". */
  fromLabel: string;
  /** La anterior tenía un período para todo el documento: el que sigue. */
  uniform: UnitPeriod | null;
  /** La anterior iba por depto: el que sigue para cada unidad (unit_id →). */
  units: UnitPeriods;
}

/** "Octubre 2026 · DF-1 2/3 · DF-2 3/3" — `formatPeriodFull` con deptos. */
export function formatSettlementPeriodFull(
  s: {
    period_year: number;
    period_month: number;
    period_index?: number | null;
    period_cycle?: number | null;
    unit_periods?: unknown;
  },
  codes?: ReadonlyMap<string, string>,
): string {
  const base = formatPeriod(s.period_year, s.period_month);
  const suffix = describeSettlementPeriod(s, codes);
  return suffix ? `${base} · ${suffix}` : base;
}

/**
 * Número de liquidación legible y determinístico: LIQ-2026-05-AB12CD.
 * Mismo criterio que el comprobante de Caja (REC-…) para consistencia.
 */
export function settlementNumber(id: string, year: number, month: number): string {
  const mm = String(month).padStart(2, "0");
  const shortId = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `LIQ-${year}-${mm}-${shortId}`;
}

export const SETTLEMENT_STATUS_META: Record<
  SettlementStatus,
  { label: string; color: string; description: string }
> = {
  borrador:  { label: "Borrador",  color: "#64748b", description: "Editable. Aún no revisada." },
  revisada:  { label: "Revisada",  color: "#3b82f6", description: "Verificada, lista para enviar." },
  enviada:   { label: "Enviada",   color: "#a855f7", description: "Enviada al propietario." },
  pagada:    { label: "Pagada",    color: "#10b981", description: "Transferida e impactada en Caja." },
  disputada: { label: "Disputada", color: "#f59e0b", description: "El propietario objetó el importe." },
  anulada:   { label: "Anulada",   color: "#ef4444", description: "Liquidación sin efecto." },
};

/**
 * Etiquetas del historial. Varias acciones comparten un `action` genérico
 * (`row_update`, `line_update`) y se distinguen por `changes.kind`: cuando el
 * kind existe, gana él — si no, el historial decía "Reserva editada" al mover
 * un tipo de cambio o el período.
 *
 * Fuente única: la usa el panel de historial y también el tooltip de los
 * botones Deshacer / Rehacer, que tienen que nombrar el MISMO cambio.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  // Migración 073: liquidación armada en blanco, para cargar a mano.
  create: "Creada en blanco",
  line_add: "Cargo agregado",
  row_add: "Reserva agregada",
  line_update: "Cargo editado",
  line_delete: "Cargo eliminado",
  row_update: "Reserva editada",
  status_change: "Cambio de estado",
  payment: "Pago registrado",
  // Migración 069: el pago se anuló y la liquidación volvió a Revisada.
  payment_undo: "Pago anulado",
  regenerate: "Regenerada",
  undo: "Cambio deshecho",
  redo: "Cambio rehecho",
};

export const AUDIT_KIND_LABEL: Record<string, string> = {
  period_cycle: "Período actualizado",
  exchange_rate: "Tipo de cambio",
  reorder_lines: "Cargos reordenados",
  reorder_bookings: "Reservas reordenadas",
  reorder_units: "Unidades reordenadas",
  move_booking_unit: "Reserva movida de unidad",
  regenerate: "Regenerada",
  undo: "Cambio deshecho",
  redo: "Cambio rehecho",
};

/** "Cargo eliminado" / "Tipo de cambio" — el kind manda sobre el action. */
export function describeAuditChange(
  action: string,
  changes?: Record<string, unknown> | null,
): string {
  const kind = changes?.kind;
  if (typeof kind === "string" && AUDIT_KIND_LABEL[kind]) {
    return AUDIT_KIND_LABEL[kind];
  }
  return AUDIT_ACTION_LABEL[action] ?? action;
}

export const SETTLEMENT_LINE_META: Record<
  SettlementLine["line_type"],
  { label: string; color: string }
> = {
  booking_revenue:       { label: "Reserva",       color: "#10b981" },
  monthly_rent_fraction: { label: "Renta mensual", color: "#7c3aed" },
  commission:            { label: "Comisión",      color: "#a855f7" },
  channel_commission:    { label: "Comisión del canal", color: "#f43f5e" },
  cleaning_charge:       { label: "Limpieza",      color: "#06b6d4" },
  maintenance_charge:    { label: "Mantenimiento", color: "#f97316" },
  expenses_fraction:     { label: "Expensas",      color: "#a78bfa" },
  adjustment:            { label: "Ajuste",        color: "#64748b" },
  owner_collected:       { label: "Cobrado por el propietario", color: "#0ea5e9" },
};

/**
 * Estados en los que se pueden editar las líneas / importes de la liquidación.
 * Editable en cualquier estado salvo "anulada" (sin efecto). Si la liquidación
 * ya tiene pago registrado, la edición NO reescribe el egreso original: postea
 * un asiento de ajuste por la diferencia (ver settlements.ts).
 */
export const EDITABLE_STATUSES: SettlementStatus[] = [
  "borrador",
  "revisada",
  "enviada",
  "pagada",
  "disputada",
];

/** Solo "borrador" se puede regenerar desde cero (recalcula líneas auto). */
export const REGENERABLE_STATUSES: SettlementStatus[] = ["borrador"];

/**
 * Estados que se eligen a mano desde el menú del estado, en cualquier orden
 * (enviada → revisada, revisada → borrador…). Quedan afuera:
 *   • "pagada": la pone «Registrar pago» junto con el egreso en Caja. Marcarla
 *     a mano dejaría una liquidación pagada que Caja no conoce.
 *   • "anulada": es terminal — no se regenera y el único por
 *     owner+mes+moneda bloquea generar otra. Una generada por error se elimina.
 * Una liquidación pagada tampoco SALE de "pagada" por acá: su egreso queda
 * protegido en Caja mientras esté revisada/enviada/pagada (cash_movement_settlement_lock).
 * Para eso está «Anular el pago» (migración 069): borra los movimientos del
 * pago en la misma transacción y la deja revisada.
 */
export const MANUAL_SETTLEMENT_STATUSES = [
  "borrador",
  "revisada",
  "enviada",
  "disputada",
] as const satisfies readonly SettlementStatus[];

export type ManualSettlementStatus = (typeof MANUAL_SETTLEMENT_STATUSES)[number];

/**
 * Estados "cerrados contablemente": editar acá impacta Caja mediante un
 * asiento de ajuste y el movimiento queda protegido (cash_movement_settlement_lock).
 */
export const LOCKED_STATUSES: SettlementStatus[] = ["revisada", "enviada", "pagada"];

/**
 * Rótulo del neto de una liquidación. Negativo = el propietario cobró directo
 * de los huéspedes (se descuenta como "Ajuste −" en Otros cargos) y le debe a
 * la administración la diferencia. Con "Neto por pagar −$ 300.750" y su CBU
 * bajo "Pagar a", el documento le decía lo contrario (Habitana, 28/10/2026).
 * El importe se muestra en positivo: el rótulo ya dice quién le paga a quién.
 * Pagada: "Neto pagado" — con "por pagar" una liquidación ya saldada parecía
 * una deuda, y la tentación era anular el pago para dejarla en cero.
 */
export function settlementNetLabel(net: number, status?: string | null): string {
  if (net < 0) return "A cargo del propietario";
  return status === "pagada" ? "Neto pagado" : "Neto por pagar";
}

/** "Pagado el 27/10/2026 · saldo" — lo que acompaña al neto de una pagada. */
export function settlementPaidCaption(paidAt: string | null, formatDay: (iso: string) => string): string {
  return paidAt ? `Pagado el ${formatDay(paidAt)} · saldo` : "Pagado · saldo";
}
