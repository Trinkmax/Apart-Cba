import type { PaymentReportStatus, RentalProofStatus, RentalServiceKind } from "@/lib/types/database";

/**
 * Tipos compartidos de la tajada "Comprobantes" (panel) entre las server
 * actions (`src/lib/actions/rentals-proofs.ts`) y los componentes cliente.
 * Sin runtime: sólo tipos.
 */

/** Lo mínimo del contrato para mostrar quién y dónde en cada fila. */
export interface ProofContractRef {
  contractId: string;
  contractNumber: number;
  contractStatus: string;
  propertyId: string;
  propertyCode: string;
  /** "Dean Funes 450 · 3°B" */
  address: string;
  tenantName: string | null;
  /** Dígitos para wa.me (vacío si no hay teléfono). */
  tenantWhatsapp: string;
  tenantEmail: string | null;
  currency: string;
  /** Link absoluto del portal del inquilino (null si está apagado o sin activar). */
  portalUrl: string | null;
}

export interface ProofItem extends ProofContractRef {
  id: string;
  kind: RentalServiceKind;
  /** Primer día del mes (YYYY-MM-01). */
  period: string;
  status: RentalProofStatus;
  amount: number | null;
  proofCurrency: string | null;
  dueDate: string | null;
  hasFile: boolean;
  fileMime: string | null;
  fileName: string | null;
  fileSize: number | null;
  uploadedAt: string | null;
  uploadedVia: "staff" | "portal" | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

/** Un tipo de comprobante que falta en el mes (con o sin fila creada). */
export interface MissingProofKind {
  kind: RentalServiceKind;
  /** Fila existente (pendiente o rechazada); null si el cron todavía no la creó. */
  proofId: string | null;
  status: "pendiente" | "rechazado" | null;
  rejectionReason: string | null;
}

export interface MissingProofContract extends ProofContractRef {
  month: string;
  kinds: MissingProofKind[];
  /** Mensaje listo para mandar por WhatsApp (sin emojis: iOS los rompe en ?text=). */
  whatsappText: string;
}

export interface PaymentReportItem extends ProofContractRef {
  id: string;
  amount: number | null;
  reportCurrency: string | null;
  paidOn: string | null;
  note: string | null;
  hasFile: boolean;
  fileMime: string | null;
  status: PaymentReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  paymentId: string | null;
  /** Lo que debe hoy el contrato (sin punitorios del día), para comparar con el aviso. */
  debt: number | null;
}

export interface ProofsKpi {
  month: string;
  /** Contratos que tienen que presentar expensas este mes. */
  expensasRequired: number;
  expensasValidated: number;
  expensasInReview: number;
  /** Comprobantes que faltan (todos los tipos) y en cuántos contratos. */
  missingCount: number;
  contractsWithMissing: number;
}

export interface ProofsBoardData {
  month: string;
  today: string;
  orgName: string;
  review: ProofItem[];
  reviewed: ProofItem[];
  missing: MissingProofContract[];
  reports: PaymentReportItem[];
  kpi: ProofsKpi;
}

/** Estado de una celda de la grilla meses × tipos del contrato. */
export type ProofCellState =
  | "validado"
  | "en_revision"
  | "rechazado"
  | "no_corresponde"
  /** Se pide y todavía no llegó. */
  | "falta"
  /** Ese mes no se pide (servicio bimestral, otro pagador…). */
  | "no_pedido"
  /** Fuera del contrato (antes de empezar a cobrar o después del fin). */
  | "fuera";

export interface ProofGridCell {
  kind: RentalServiceKind;
  month: string;
  state: ProofCellState;
  expected: boolean;
  proof: ProofItem | null;
}

export interface ProofGridRow {
  kind: RentalServiceKind;
  cells: ProofGridCell[];
}

export interface ContractProofGridData {
  contract: ProofContractRef;
  today: string;
  orgName: string;
  months: string[];
  rows: ProofGridRow[];
  /** Meses con expensas validadas sobre los que se pedían (para el resumen). */
  expensasOk: number;
  expensasExpected: number;
  pendingReview: number;
}

/** Destino de "No corresponde" / "Subir": fila existente o clave (contrato, tipo, mes). */
export interface ProofKey {
  contractId: string;
  kind: RentalServiceKind;
  period: string;
}
