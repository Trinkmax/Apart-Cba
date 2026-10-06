import { describe, expect, it } from "vitest";
import { sameFormValues } from "../form-draft";
import { personDraftKind, personStateFromDraft } from "../person-draft";
import type { PersonFormState } from "../person-form";

function blank(name = ""): PersonFormState {
  return {
    person_type: "fisica",
    full_name: name,
    doc_type: "DNI",
    doc_number: "",
    tax_id: "",
    birth_date: "",
    nationality: "",
    email: "",
    phone: "",
    phone_alt: "",
    address: "",
    city: "",
    province: "",
    occupation: "",
    employer: "",
    employer_phone: "",
    income: "",
    income_currency: "ARS",
    notes: "",
  };
}

describe("personStateFromDraft", () => {
  it("recupera lo tipeado", () => {
    const state = personStateFromDraft(blank(), { full_name: "Juana Pérez", doc_number: "30.123.456", person_type: "fisica", income_currency: "USD" });
    expect(state.full_name).toBe("Juana Pérez");
    expect(state.doc_number).toBe("30.123.456");
    expect(state.income_currency).toBe("USD");
  });

  it("los menús sólo aceptan sus opciones", () => {
    const state = personStateFromDraft(blank(), { person_type: "robot", doc_type: "LIBRETA", income_currency: "EUR" });
    expect(sameFormValues(state, blank())).toBe(true);
  });

  it("el nombre que trae el buscador completa un borrador sin nombre, sin pisar uno escrito", () => {
    expect(personStateFromDraft(blank("Juan"), { full_name: "", email: "j@x.com" }).full_name).toBe("Juan");
    expect(personStateFromDraft(blank("Juan"), { full_name: "María Gómez" }).full_name).toBe("María Gómez");
  });
});

describe("personDraftKind", () => {
  it("un borrador por rol", () => {
    expect(personDraftKind("inquilino")).not.toBe(personDraftKind("garante"));
    expect(personDraftKind(undefined)).toBe("persona.general");
  });
});
