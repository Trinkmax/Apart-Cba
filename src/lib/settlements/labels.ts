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

/** Estados en los que la liquidación todavía es editable (líneas, regenerar). */
export const EDITABLE_STATUSES: SettlementStatus[] = ["borrador"];

/** Estados "cerrados" — bloquean edición de líneas y del movimiento de Caja. */
export const LOCKED_STATUSES: SettlementStatus[] = ["revisada", "enviada", "pagada"];
