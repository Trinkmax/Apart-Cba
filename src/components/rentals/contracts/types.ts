import type { ContractDisplayState } from "@/lib/rentals/labels";
import type { SchedulePeriod } from "@/lib/rentals/schedule";
import type {
  RentalAdjustmentStatus,
  RentalContract,
  RentalContractStatus,
  RentalGuaranteeType,
  RentalIndexCode,
  RentalPartyRole,
  RentalPersonType,
  RentalPropertyType,
  RentalSettings,
} from "@/lib/types/database";
import type { TimelineAdjustment } from "./adjustment-view";
import type { EntryBreakdown, EntryChargeItemDraft } from "./entry-breakdown";
import type { WizardSettings } from "./wizard-state";

/** Tipos compartidos entre las lecturas del servidor y las pantallas de Contratos. */

export type ContractListView = "vigentes" | "por_vencer" | "borradores" | "terminados";

export const CONTRACT_TABS = ["resumen", "cuenta", "ajustes", "servicios", "gastos", "documentos", "historial"] as const;
export type ContractTab = (typeof CONTRACT_TABS)[number];

export interface ContractNextAdjustment {
  date: string;
  days: number;
  status: RentalAdjustmentStatus;
  amount: number | null;
  variationPct: number | null;
}

export interface ContractListRow {
  id: string;
  number: number;
  status: RentalContractStatus;
  displayState: ContractDisplayState;
  propertyId: string;
  propertyCode: string;
  address: string;
  city: string;
  tenantId: string | null;
  tenantName: string | null;
  /** Otros inquilinos además del titular. */
  extraTenants: number;
  startDate: string;
  endDate: string;
  daysToEnd: number;
  terminatedAt: string | null;
  currency: string;
  currentRent: number;
  periodIndex: number | null;
  /** "Período 2/3" */
  periodLabel: string | null;
  durationMonths: number;
  /** "IPC · trimestral" */
  methodLabel: string;
  nextAdjustment: ContractNextAdjustment | null;
  adjustsThisMonth: boolean;
  /** Saldo abierto (vencido + por vencer). */
  debt: number;
  overdue: number;
  /** Saldo a favor del inquilino. */
  credit: number;
}

export interface ContractListResult {
  rows: ContractListRow[];
  counts: Record<ContractListView, number>;
  total: number;
}

export interface PropertyOwnerOption {
  ownerId: string;
  name: string;
  pct: number;
  isPrimary: boolean;
}

export interface PropertyOption {
  id: string;
  code: string;
  address: string;
  city: string;
  propertyType: RentalPropertyType;
  owners: PropertyOwnerOption[];
  /** Contrato vigente (o borrador) que ya ocupa la propiedad. */
  busyWith: { contractId: string; number: number; status: RentalContractStatus; endDate: string } | null;
  listingRent: number | null;
  listingCurrency: string | null;
}

export interface PersonOption {
  id: string;
  fullName: string;
  personType: RentalPersonType;
  /** "DNI 30.123.456" */
  docLabel: string | null;
  phone: string | null;
  email: string | null;
  employer: string | null;
  monthlyIncome: number | null;
}

export type ContractFormSettings = WizardSettings &
  Pick<RentalSettings, "stamp_tax_rate_pct" | "stamp_tax_exempt_monthly" | "stamp_tax_tenant_share_pct" | "auto_apply_adjustments" | "vat_condition">;

export interface ContractFormOptions {
  properties: PropertyOption[];
  people: PersonOption[];
  owners: { id: string; name: string }[];
  accounts: { id: string; name: string; currency: string }[];
  settings: ContractFormSettings;
  today: string;
}

export interface PlanPreview {
  endDate: string;
  schedule: SchedulePeriod[];
  adjustments: TimelineAdjustment[];
  /** El contrato ya empezó (inicio ≤ hoy). */
  started: boolean;
  /** Alquiler que corresponde hoy según el índice (aplicados + calculados), si ya empezó. */
  rentToday: number | null;
  todayPeriodIndex: number | null;
  /** Hay ajustes que ya deberían regir y esperan el índice. */
  waitingIndex: boolean;
  nextAdjustment: TimelineAdjustment | null;
  projectedTotal: number;
  entry: EntryBreakdown;
  index: {
    code: RentalIndexCode;
    label: string;
    name: string;
    publisher: string;
    frequency: "monthly" | "daily";
    lastKey: string | null;
  } | null;
  /** "Para el ajuste de junio se usa la inflación de febrero, marzo y abril." */
  lagExample: string | null;
}

export interface ContractPartyView {
  personId: string;
  role: RentalPartyRole;
  isPrimary: boolean;
  name: string;
  docLabel: string | null;
  phone: string | null;
  email: string | null;
  guaranteeType: RentalGuaranteeType | null;
  guaranteeDetail: string | null;
  consentAt: string | null;
}

export interface ContractBalance {
  currency: string;
  debt: number;
  overdue: number;
  credit: number;
  openCharges: number;
  oldestOverdueDue: string | null;
  nextDue: { id: string; label: string; dueDate: string; outstanding: number } | null;
  hasPayments: boolean;
}

export interface ContractDetailData {
  contract: RentalContract;
  displayState: ContractDisplayState;
  today: string;
  property: { id: string; code: string; address: string; city: string; propertyType: RentalPropertyType };
  owners: (PropertyOwnerOption & { phone: string | null; email: string | null })[];
  parties: ContractPartyView[];
  schedule: SchedulePeriod[];
  adjustments: TimelineAdjustment[];
  /** Alquiler que rige hoy (sólo ajustes aplicados). */
  rentInForce: number;
  nextAdjustment: TimelineAdjustment | null;
  balance: ContractBalance;
  /** Link del portal del inquilino (path) si el contrato ya está activo. */
  portalPath: string | null;
  /** Ítems sugeridos para el cargo de ingreso (al activar un borrador). */
  entrySuggestion: EntryChargeItemDraft[];
  renewedFrom: { id: string; number: number } | null;
  renewal: { id: string; number: number; status: RentalContractStatus } | null;
}
