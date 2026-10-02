import type {
  RentalContractStatus,
  RentalDocType,
  RentalGuaranteeType,
  RentalPartyRole,
  RentalPerson,
  RentalPersonType,
} from "@/lib/types/database";
import type { ContractDisplayState } from "@/lib/rentals/labels";

/** Tipos compartidos entre las actions de Personas y sus pantallas (sin runtime). */

export interface PersonInput {
  person_type: RentalPersonType;
  full_name: string;
  doc_type: RentalDocType | null;
  doc_number: string | null;
  tax_id: string | null;
  birth_date: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  phone_alt: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  occupation: string | null;
  employer: string | null;
  employer_phone: string | null;
  monthly_income: number | null;
  income_currency: string | null;
  notes: string | null;
}

/** Un contrato en el que participa la persona (como inquilino o garante). */
export interface PersonContractLink {
  contract_id: string;
  number: number;
  status: RentalContractStatus;
  display_state: ContractDisplayState;
  role: RentalPartyRole;
  is_primary: boolean;
  guarantee_type: RentalGuaranteeType | null;
  start_date: string;
  end_date: string;
  currency: string;
  current_rent: number;
  property: { id: string; code: string; address: string } | null;
  /** Inquilino titular del contrato (útil cuando la persona es garante). */
  tenant_name: string | null;
  balance: number;
  overdue: number;
}

export interface PersonListItem {
  person: RentalPerson;
  /** Contratos vigentes o en borrador donde participa. */
  links: PersonContractLink[];
  /** Si alguna vez tuvo contratos (terminados). */
  past_contracts: number;
}

export interface PersonDetail {
  person: RentalPerson;
  links: PersonContractLink[];
}

export type PersonSaveResult =
  | { ok: true; person: RentalPerson }
  | { ok: false; error: string; field?: string; existing?: RentalPerson };
