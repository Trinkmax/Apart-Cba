import type { RentalExpense } from "@/lib/types/database";

/**
 * Tipos que devuelven las server actions de Gastos
 * (`src/lib/actions/rentals-expenses.ts`; un archivo "use server" sólo
 * exporta funciones async).
 */

export interface ExpenseListItem {
  expense: RentalExpense;
  propertyLabel: string;
  contractNumber: string | null;
  accountName: string | null;
  /**
   * Rendiciones vivas que lo descuentan, de la más vieja a la más nueva
   * (number "0012"). Con varios dueños hay una por dueño; vacío si todavía no
   * se descontó.
   */
  statements: { id: string; number: string }[];
  /** "Octubre 2026 · Período 2/3" si ya se le cargó al inquilino. */
  chargeLabel: string | null;
  createdByName: string | null;
}

export interface ExpensesSummary {
  /** Por moneda: lo que falta descontar a propietarios / cobrar a inquilinos / pagar. */
  byCurrency: { currency: string; toDeduct: number; toCharge: number; unpaid: number; total: number }[];
  count: number;
}

export interface ExpenseContractOption {
  id: string;
  /** "C-0007 · Ana Gómez" */
  label: string;
  status: string;
  currency: string;
  /** Vigente o borrador: puede recibir el gasto en un próximo cargo. */
  canCharge: boolean;
}

export interface ExpenseAccountOption {
  id: string;
  name: string;
  currency: string;
  type: string;
  color: string | null;
}

export interface ExpenseFormOptions {
  property: { id: string; label: string; code: string | null };
  contracts: ExpenseContractOption[];
  accounts: ExpenseAccountOption[];
  currencies: string[];
  defaultCurrency: string;
  /** Dueños y % (para explicar a quién se le descuenta). */
  owners: { name: string; pct: number }[];
  today: string;
}
