import type { PaymentReportStatus, RentalChargeItemKind, RentalProofStatus, RentalServiceKind } from "@/lib/types/database";
import type { ContractDisplayState } from "@/lib/rentals/labels";

/**
 * Lo que ve el inquilino en su link (`/inquilino/<token>`). Es TODO lo que sale
 * del servidor hacia la página pública: nada de DNI, garantes, propietarios ni
 * datos internos. Sin runtime: sólo tipos.
 */

export interface TenantPortalOrg {
  name: string;
  logoUrl: string | null;
  /** Color de marca resuelto (#0F766E si la org no tiene). */
  brandColor: string;
  phone: string | null;
  /** Dígitos para wa.me (vacío si no hay teléfono). */
  whatsapp: string;
  email: string | null;
  /** Texto libre de la inmobiliaria con CBU/alias para transferir. */
  paymentInstructions: string | null;
}

export interface TenantPortalChargeItem {
  kind: RentalChargeItemKind;
  description: string;
  /** Lo que falta pagar de este concepto. */
  outstanding: number;
}

export interface TenantPortalCharge {
  id: string;
  label: string;
  dueDate: string;
  total: number;
  paid: number;
  /** Lo que falta, con los intereses por mora del día incluidos. */
  outstanding: number;
  state: "pendiente" | "parcial" | "vencido";
  items: TenantPortalChargeItem[];
  lateFee: { daysLate: number; amount: number; explanation: string } | null;
}

export interface TenantPortalPayment {
  id: string;
  paidAt: string;
  amount: number;
  currency: string;
  methodLabel: string;
  /** "000123" */
  receiptNumber: string | null;
}

export interface TenantPortalProof {
  /** null si todavía no hay fila (se pide y no llegó). */
  id: string | null;
  kind: RentalServiceKind;
  period: string;
  status: RentalProofStatus;
  amount: number | null;
  rejectionReason: string | null;
  uploadedAt: string | null;
  canUpload: boolean;
}

export interface TenantPortalProofMonth {
  month: string;
  proofs: TenantPortalProof[];
}

export interface TenantPortalAdjustment {
  effectiveDate: string;
  from: number | null;
  to: number;
  variationPct: number | null;
  explanation: string;
}

export interface TenantPortalNextAdjustment {
  date: string;
  /** Monto si ya se pudo calcular (índice publicado). */
  amount: number | null;
  explanation: string;
}

export interface TenantPortalReport {
  id: string;
  createdAt: string;
  amount: number | null;
  paidOn: string | null;
  status: PaymentReportStatus;
  /** Motivo si se descartó (lo escribe el equipo). */
  reason: string | null;
}

export interface TenantPortalView {
  org: TenantPortalOrg;
  today: string;
  tenantFirstName: string;
  contract: {
    number: string;
    address: string;
    city: string;
    /** El mismo estado que ve el staff (incluye la salida avisada o programada). */
    status: ContractDisplayState;
    statusLabel: string;
    startDate: string;
    endDate: string;
    /** Día que desocupa si hay una salida registrada (rescisión notificada o entrega programada). */
    moveOutDate: string | null;
    currency: string;
    currentRent: number;
    /** "Se actualiza cada 3 meses por IPC". */
    adjustmentSummary: string;
    /** Explicación simple del índice (null si no usa índice). */
    indexExplanation: string | null;
    /** El alquiler lo cobra el propietario directamente. */
    paysOwnerDirectly: boolean;
  };
  debt: {
    total: number;
    overdue: number;
    charges: TenantPortalCharge[];
  };
  /** Saldo a favor (pagos sin imputar). */
  credit: number;
  payments: TenantPortalPayment[];
  receiptsAvailable: boolean;
  proofs: {
    currentMonth: string;
    current: TenantPortalProof[];
    history: TenantPortalProofMonth[];
  };
  adjustments: TenantPortalAdjustment[];
  nextAdjustment: TenantPortalNextAdjustment | null;
  reports: TenantPortalReport[];
  canReportPayment: boolean;
  canUpload: boolean;
}
