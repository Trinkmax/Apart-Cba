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
  line_add: "Cargo agregado",
  row_add: "Reserva agregada",
  line_update: "Cargo editado",
  line_delete: "Cargo eliminado",
  row_update: "Reserva editada",
  status_change: "Cambio de estado",
  payment: "Pago registrado",
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
  cleaning_charge:       { label: "Limpieza",      color: "#06b6d4" },
  maintenance_charge:    { label: "Mantenimiento", color: "#f97316" },
  expenses_fraction:     { label: "Expensas",      color: "#a78bfa" },
  adjustment:            { label: "Ajuste",        color: "#64748b" },
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
 * Estados "cerrados contablemente": editar acá impacta Caja mediante un
 * asiento de ajuste y el movimiento queda protegido (cash_movement_settlement_lock).
 */
export const LOCKED_STATUSES: SettlementStatus[] = ["revisada", "enviada", "pagada"];
