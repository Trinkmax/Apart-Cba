import type { IndexSummary } from "@/components/rentals/indices/index-model";
import type { Agenda } from "./agenda";

/** Importes por moneda ({ ARS: 1.500.000, USD: 800 }). */
export type CurrencyAmounts = Record<string, number>;

export interface DashboardKpis {
  /** Mes del resumen (YYYY-MM-01). */
  month: string;
  /** Lo que vence este mes (cargos no anulados). */
  expected: CurrencyAmounts;
  /** Lo cobrado de esos cargos. */
  collected: CurrencyAmounts;
  /** De este mes, lo que todavía no venció y falta cobrar. */
  pending: CurrencyAmounts;
  /** Deuda vencida de cualquier mes. */
  overdue: CurrencyAmounts;
  overdueContracts: number;
  activeContracts: number;
  draftContracts: number;
  totalProperties: number;
  rentedProperties: number;
  vacantProperties: number;
  /** Honorarios del mes (administración + comisiones), estimado sobre lo que vence. */
  feesExpected: CurrencyAmounts;
  /** Honorarios sobre lo ya cobrado. */
  feesCollected: CurrencyAmounts;
  proofsInReview: number;
  adjustmentsNext30: number;
}

export interface UpcomingAdjustmentRow {
  id: string;
  contractId: string;
  contractNumber: number;
  address: string;
  tenantName: string | null;
  effectiveDate: string;
  status: string;
  baseAmount: number | null;
  newAmount: number | null;
  variationPct: number | null;
  currency: string;
  indexCode: string | null;
  toKey: string | null;
}

export interface ExpiringContractRow {
  contractId: string;
  contractNumber: number;
  address: string;
  tenantName: string | null;
  endDate: string;
  /** Negativo = ya venció y sigue abierto. */
  daysLeft: number;
}

export interface RentalsDashboardData {
  today: string;
  greeting: string;
  firstName: string;
  mainCurrency: string;
  /** false = la organización todavía no cargó ningún contrato (mostrar el onboarding). */
  hasContracts: boolean;
  kpis: DashboardKpis;
  agenda: Agenda;
  upcomingAdjustments: UpcomingAdjustmentRow[];
  expiring: ExpiringContractRow[];
  indices: IndexSummary[];
}

/** Suma a un mapa por moneda. */
export function addTo(map: CurrencyAmounts, currency: string, amount: number): void {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
  map[currency] = Math.round(((map[currency] ?? 0) + amount) * 100) / 100;
}

/** Monedas presentes, con la principal primero. */
export function currenciesOf(main: string, ...maps: CurrencyAmounts[]): string[] {
  const set = new Set<string>([main]);
  for (const m of maps) for (const k of Object.keys(m)) set.add(k);
  return [...set];
}

/** "Buen día" / "Buenas tardes" / "Buenas noches" según la hora local de la org. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 13) return "Buen día";
  if (hour >= 13 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}
