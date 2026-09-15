"use server";

/**
 * Resultados del mes — orquestador de lectura.
 *
 * El pedido del dueño: "Resultados no puede tomar el ingreso de la
 * liquidación". Los operadores editan la fila de la liquidación (el huésped
 * paga 80.000 y al propietario se le rinde sobre 70.000), así que:
 *   • lo que pagó el huésped sale SIEMPRE del calendario (`bookings`);
 *   • lo que se le rinde al propietario sale de SU liquidación;
 *   • la diferencia se muestra reserva por reserva y nunca se mezcla con
 *     errores de carga ni con estimaciones.
 *
 * Toda la aritmética vive en src/lib/finance/results-reconciliation.ts
 * (`reconcileMonth`, puro y con tests) y las queries en
 * src/lib/finance/results-loader.ts (`loadReconcileInput`). Este archivo es el
 * borde de seguridad: sesión, org activa y permiso; después carga y concilia.
 * Es SOLO LECTURA: no escribe nada, no genera liquidaciones.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireSession } from "./auth";
import { getCurrentOrg } from "./org";
import { can } from "@/lib/permissions";
import { DEFAULT_COMMISSION_BASE, type CommissionBase } from "@/lib/finance/booking-economics";
import { periodFromIndex } from "@/lib/finance/prorate";
import {
  reconcileMonth,
  type ChannelCommissions,
  type ReconcileOrgInput,
  type ReconciledMonth,
  type ResultsMode,
} from "@/lib/finance/results-reconciliation";
import { loadReconcileInput } from "@/lib/finance/results-loader";
import type { BookingSource } from "@/lib/types/database";

export type {
  AggregateRow,
  AggregateView,
  ChannelCommissions,
  Coverage,
  EstimatedAmounts,
  ExtraChargeInput,
  FlowAmounts,
  InfoFlag,
  IssueCode,
  MonthClose,
  OrphanReason,
  OrphanRow,
  Outcome,
  OwnerBridge,
  PieceSummary,
  ReconciledMonth,
  ReconciledRow,
  ResultTotals,
  ResultsMode,
  ReviewGroup,
  ReviewItem,
  ReviewWhere,
  RowEstimated,
  RowIssue,
  RowLevel,
  RowOwnerSplit,
  RowSettled,
} from "@/lib/finance/results-reconciliation";

export type MonthlyResults = ReconciledMonth & {
  year: number;
  month: number;
  mode: ResultsMode;
  /** Moneda de la tarjeta completa (`organizations.default_currency`). */
  base_currency: string;
  commission_base: CommissionBase;
  /** Mapa canal → % configurado en la org (para explicar de dónde sale cada número). */
  channel_commissions: Partial<Record<BookingSource, number>>;
  /** "YYYY-MM" de la primera liquidación no anulada de la org, o null si no hay. */
  first_settlement_period: string | null;
};

function periodLabel(index: number): string {
  const { year, month } = periodFromIndex(index);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function getMonthlyResults(
  year: number,
  month: number,
  opts: { mode?: ResultsMode } = {},
): Promise<MonthlyResults> {
  await requireSession();
  const { organization, role } = await getCurrentOrg();
  // Sólo quien ve la plata de la organización (admin/recepción). `settlements.view`
  // no alcanza: owner_view lo tiene para mirar SUS liquidaciones, y acá se ven
  // los números de todos los propietarios y la comisión de la administración.
  if (!can(role, "payments", "view")) {
    throw new Error("No tenés permiso para ver los resultados");
  }
  const admin = createAdminClient();

  // Defensa propia además de la del page: un año fuera de rango arma un
  // literal de fecha inválido y PostgREST devuelve 22007.
  const currentYear = new Date().getUTCFullYear();
  const y = Number.isFinite(year) ? Math.min(currentYear + 5, Math.max(2000, Math.trunc(year))) : currentYear;
  const m = Number.isFinite(month) ? Math.min(12, Math.max(1, Math.trunc(month))) : 1;
  // El modo llega de la URL: cualquier otra cosa es "todos".
  const mode: ResultsMode = opts.mode === "temporario" || opts.mode === "mensual" ? opts.mode : "todos";

  const baseCurrency = organization.default_currency || "ARS";
  const commissionBase: CommissionBase = organization.commission_base ?? DEFAULT_COMMISSION_BASE;
  const channelCommissions: ChannelCommissions = organization.channel_commissions ?? {};
  const org: ReconcileOrgInput = {
    base_currency: baseCurrency,
    commission_base: commissionBase,
    channel_commissions: channelCommissions,
    commission_by_source: organization.commission_by_source ?? {},
    default_commission_pct: organization.default_commission_pct,
    // Los cobros extra de un mensual se imputan al mes del movimiento en la
    // zona horaria de la org (igual que Caja).
    timezone: organization.timezone,
  };

  // Todas las queries filtran por la org activa (organization.id).
  const input = await loadReconcileInput(admin, { orgId: organization.id, org, year: y, month: m, mode });
  const reconciled = reconcileMonth(input);

  return {
    ...reconciled,
    year: y,
    month: m,
    mode,
    base_currency: baseCurrency,
    commission_base: commissionBase,
    channel_commissions: channelCommissions,
    first_settlement_period:
      input.firstSettlementPeriod === null ? null : periodLabel(input.firstSettlementPeriod),
  };
}
