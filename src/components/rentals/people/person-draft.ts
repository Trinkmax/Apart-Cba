import type { RentalDocType, RentalPersonType } from "@/lib/types/database";
import { mergeDraft, oneOf } from "./form-draft";
import type { PersonFormState } from "./person-form";

/**
 * Del borrador guardado (sessionStorage) al estado del formulario de alta de
 * inquilino / garante. Lo que no encaja queda como en un alta vacía.
 */

const DOC_TYPES: readonly RentalDocType[] = ["DNI", "CUIL", "CUIT", "PASAPORTE", "OTRO"];
const PERSON_TYPES: readonly RentalPersonType[] = ["fisica", "juridica"];

/** Clave del borrador según con qué rol se abre el alta (no se mezcla un garante a medio cargar con un inquilino). */
export function personDraftKind(intent: "inquilino" | "garante" | undefined): string {
  return `persona.${intent ?? "general"}`;
}

export function personStateFromDraft(blank: PersonFormState, stored: Record<string, unknown>): PersonFormState {
  const state = mergeDraft(blank, stored, {
    person_type: oneOf(PERSON_TYPES),
    doc_type: oneOf(DOC_TYPES),
    income_currency: oneOf(["ARS", "USD"] as const),
  });
  // Lo que abre el alta desde un buscador ("Inquilino nuevo" con lo tipeado) completa el nombre si el borrador no lo tenía.
  if (!state.full_name.trim() && blank.full_name.trim()) return { ...state, full_name: blank.full_name };
  return state;
}
