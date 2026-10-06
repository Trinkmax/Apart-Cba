import type {
  RentalContractStatus,
  RentalGuaranteeType,
  RentalPartyRole,
  RentalProperty,
  RentalPropertyAvailability,
  RentalPropertyServiceAccount,
  RentalPropertyType,
} from "@/lib/types/database";
import type { ContractDisplayState } from "@/lib/rentals/labels";
import type { PropertyDisplayState } from "./property-helpers";

/** Tipos compartidos entre las actions de Propiedades y sus pantallas (sin runtime). */

export interface PropertyOwnerInput {
  owner_id: string;
  ownership_pct: number;
  is_primary: boolean;
}

/** Propietario de la tabla `owners` para el buscador. */
export interface OwnerOption {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  document_number: string | null;
}

/** Titular como quedó al guardar desde el formulario: lo recibe quien abrió el diálogo (p. ej. el asistente de contratos). */
export interface SavedPropertyOwner {
  owner_id: string;
  full_name: string;
  ownership_pct: number;
  is_primary: boolean;
}

export interface PropertyOwnerView {
  owner_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cbu: string | null;
  alias_cbu: string | null;
  bank_name: string | null;
  ownership_pct: number;
  is_primary: boolean;
}

export interface ContractPartyView {
  person_id: string;
  full_name: string;
  role: RentalPartyRole;
  is_primary: boolean;
  guarantee_type: RentalGuaranteeType | null;
}

/** Un contrato visto desde una propiedad o una persona. */
export interface ContractSummary {
  id: string;
  number: number;
  property_id: string;
  status: RentalContractStatus;
  display_state: ContractDisplayState;
  start_date: string;
  end_date: string;
  terminated_at: string | null;
  currency: string;
  current_rent: number;
  /** Inquilino titular (el de los recibos). */
  tenant: { id: string; full_name: string } | null;
  parties: ContractPartyView[];
  /** Lo que debe hoy (cargos abiertos) y la parte ya vencida. */
  balance: number;
  overdue: number;
}

export interface PropertyListItem {
  property: RentalProperty;
  state: PropertyDisplayState;
  owners: PropertyOwnerView[];
  /** Contrato vigente (a lo sumo uno por propiedad). */
  current: ContractSummary | null;
  /** Contrato en borrador (por arrancar). */
  draft: ContractSummary | null;
  /** Desde cuándo está sin contrato (fin del último), si alguna vez tuvo. */
  vacant_since: string | null;
}

export interface PropertyEventView {
  id: string;
  event_type: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
}

export interface PropertyDetail extends PropertyListItem {
  /** Todos los contratos, del más nuevo al más viejo. */
  contracts: ContractSummary[];
  events: PropertyEventView[];
}

export interface PropertyCodeRef {
  id: string;
  code: string;
  label: string;
}

export interface PropertyFormOptions {
  owners: OwnerOption[];
  /**
   * Archivados: no se ofrecen en el buscador, pero el sistema no deja crear
   * otro con el mismo nombre. El formulario lo mira ANTES de crear a un
   * propietario nuevo (si no, el segundo fallaba con el primero ya creado).
   */
  archived_owners: OwnerOption[];
  codes: PropertyCodeRef[];
  /** Titulares actuales de la propiedad que se edita (null si es alta). */
  current_owners: PropertyOwnerInput[] | null;
  /**
   * Alta: la propiedad con el id del formulario, si ya quedó guardada (se
   * perdió la respuesta o se recargó en medio del guardado), con sus titulares.
   */
  saved: { property: RentalProperty; owners: SavedPropertyOwner[] } | null;
}

/** Lo que manda el formulario. `code` vacío = lo genera el servidor desde la dirección. */
export interface PropertyInput {
  /**
   * Alta: id que generó el formulario (queda en el borrador). Si el guardado
   * llegó pero la respuesta se perdió, reintentar devuelve la misma propiedad
   * en vez de cargarla dos veces. Se ignora al editar.
   */
  id?: string | null;
  code: string;
  property_type: RentalPropertyType;
  street: string;
  street_number: string | null;
  floor: string | null;
  apartment: string | null;
  tower: string | null;
  neighborhood: string | null;
  city: string;
  province: string;
  postal_code: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  covered_m2: number | null;
  total_m2: number | null;
  furnished: boolean;
  has_garage: boolean;
  consortium_name: string | null;
  consortium_phone: string | null;
  consortium_email: string | null;
  functional_unit: string | null;
  cadastral_id: string | null;
  services: RentalPropertyServiceAccount[];
  listing_rent: number | null;
  listing_currency: string | null;
  availability: RentalPropertyAvailability;
  mandate_signed_at: string | null;
  notes: string | null;
  owners: PropertyOwnerInput[];
}

export type PropertySaveResult =
  /**
   * `already_saved`: era un reintento y la propiedad ya estaba guardada; se
   * devuelve tal cual quedó, con sus titulares (`owners`) si se pudieron leer.
   */
  | { ok: true; property: RentalProperty; already_saved?: boolean; owners?: SavedPropertyOwner[] }
  | { ok: false; error: string; field?: string; suggestion?: string };

export interface QuickOwnerInput {
  /** Id que generó el formulario para este propietario nuevo (mismo uso que `PropertyInput.id`). */
  id?: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  cbu: string | null;
  alias_cbu: string | null;
}

export type QuickOwnerResult =
  /** `already_saved`: era un reintento y el propietario ya estaba creado. */
  | { ok: true; owner: OwnerOption; already_saved?: boolean }
  /** `existing`: ya hay un propietario activo con ese nombre (para ofrecer "Usar ese propietario" aunque la lista del formulario sea vieja). */
  | { ok: false; error: string; field?: string; existing?: OwnerOption };
