import type { RentalStatementStatus } from "@/lib/types/database";
import type { OrgBranding } from "@/lib/pdf/org-header";
import type { StatementDocModel } from "./statement-model";

/**
 * Tipos que devuelven las server actions de Rendiciones
 * (`src/lib/actions/rentals-statements.ts`). Viven acá porque un archivo
 * "use server" sólo puede exportar funciones async.
 */

export interface StatementMoneyTotals {
  collected: number;
  fees: number;
  vat: number;
  expenses: number;
  other: number;
  net: number;
}

/** Tarjeta "Para rendir": un propietario con cobros (o gastos) sin rendir en una moneda. */
export interface PendingOwnerCard {
  ownerId: string;
  ownerName: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  hasBankData: boolean;
  currency: string;
  totals: StatementMoneyTotals;
  collectedCount: number;
  lastPaidAt: string | null;
  /** Direcciones que entran ("Dean Funes 450 · 3°B"). */
  properties: string[];
}

export interface PendingBoard {
  cutoff: string;
  cards: PendingOwnerCard[];
  /** Propietarios con propiedades en alquiler tradicional (para el vacío "no hay nada"). */
  ownersWithProperties: number;
}

export interface StatementListItem {
  id: string;
  number: number;
  status: RentalStatementStatus;
  currency: string;
  cutoffDate: string;
  ownerId: string;
  ownerName: string;
  collected: number;
  fees: number;
  vat: number;
  expenses: number;
  net: number;
  generatedAt: string;
  sentAt: string | null;
  paidAt: string | null;
}

export interface PayoutAccount {
  id: string;
  name: string;
  currency: string;
  type: string;
  color: string | null;
}

export interface StatementDetail {
  model: StatementDocModel;
  ownerId: string;
  orgName: string;
  branding: OrgBranding;
  /** Link público absoluto (sólo si ya se emitió). */
  publicUrl: string | null;
  whatsappText: string | null;
  ownerWhatsappDigits: string | null;
  /** Cuentas activas en la moneda de la rendición (para registrar el pago). */
  accounts: PayoutAccount[];
}

/** Lo que devuelve "Emitir" (o cualquier acción que necesite el link). */
export interface StatementShareInfo {
  path: string;
  url: string;
  whatsappText: string;
  ownerWhatsappDigits: string | null;
  ownerEmail: string | null;
}

export interface PublicStatement {
  model: StatementDocModel;
  branding: OrgBranding;
  orgContact: { email: string | null; phone: string | null };
}
