import { describe, expect, it } from "vitest";
import { sameFormValues } from "@/components/rentals/people/form-draft";
import { blankOwnerDraft, findOwnerByName, ownershipRowsOf, withProvisionalIds, type OwnerRowState } from "../owner-rows";
import { dropUnknownOwners, ownerRowsFromDraft, propertyStateFromDraft, serviceRowsFromDraft } from "../property-draft";
import type { PropertyFormState } from "../property-form";
import type { OwnerOption } from "../property-types";

const owner = (id: string, full_name: string): OwnerOption => ({ id, full_name, phone: null, email: null, document_number: null });
const row = (patch: Partial<OwnerRowState>): OwnerRowState => ({ key: "k", owner_id: "", pct: "100", is_primary: true, draft: null, ...patch });

function blank(): PropertyFormState {
  return {
    code: "",
    property_type: "departamento",
    street: "",
    street_number: "",
    floor: "",
    apartment: "",
    tower: "",
    neighborhood: "",
    city: "Córdoba",
    province: "Córdoba",
    postal_code: "",
    rooms: "",
    bedrooms: "",
    bathrooms: "",
    covered_m2: "",
    total_m2: "",
    furnished: false,
    has_garage: false,
    consortium_name: "",
    consortium_phone: "",
    consortium_email: "",
    functional_unit: "",
    cadastral_id: "",
    services: [],
    listing_rent: "",
    listing_currency: "ARS",
    availability: "disponible",
    mandate_signed_at: "",
    notes: "",
    owners: [row({ key: "k0" })],
  };
}

describe("findOwnerByName", () => {
  const options = [owner("o1", "Ulises Rojas"), owner("o2", "Facundo Cruceño")];

  it("encuentra el mismo nombre sin importar tildes, mayúsculas ni espacios", () => {
    expect(findOwnerByName(options, "  ulises   ROJAS ")?.id).toBe("o1");
    expect(findOwnerByName(options, "Facundo Cruceno")?.id).toBe("o2");
  });

  it("un nombre parecido no es el mismo", () => {
    expect(findOwnerByName(options, "Ulises")).toBeNull();
    expect(findOwnerByName(options, "U")).toBeNull();
    expect(findOwnerByName(null, "Ulises Rojas")).toBeNull();
  });
});

describe("ownershipRowsOf", () => {
  it("un solo dueño (elegido o nuevo) es el 100 % y el principal", () => {
    expect(ownershipRowsOf([row({ owner_id: "o1", pct: "", is_primary: false })])).toEqual([
      { key: "k", owner_id: "o1", ownership_pct: 100, is_primary: true, draft: null },
    ]);
    const draft = blankOwnerDraft("Ulises Rojas");
    expect(ownershipRowsOf([row({ pct: "", draft })])).toEqual([{ key: "k", owner_id: "", ownership_pct: 100, is_primary: true, draft }]);
  });

  it("la fila vacía cuenta si tiene %: así la validación pide el dueño", () => {
    expect(ownershipRowsOf([row({})])).toHaveLength(1);
    expect(ownershipRowsOf([row({ pct: "" })])).toHaveLength(0);
  });

  it("varios dueños conservan su % y su principal", () => {
    const rows = ownershipRowsOf([row({ key: "a", owner_id: "o1", pct: "60" }), row({ key: "b", owner_id: "o2", pct: "40", is_primary: false })]);
    expect(rows.map((r) => [r.owner_id, r.ownership_pct, r.is_primary])).toEqual([
      ["o1", 60, true],
      ["o2", 40, false],
    ]);
  });

  it("si la fila tiene un dueño elegido, un borrador viejo no cuenta", () => {
    expect(ownershipRowsOf([row({ owner_id: "o1", draft: blankOwnerDraft("Otro") })])[0].draft).toBeNull();
  });

  it("los nuevos validan con un id provisorio único por fila", () => {
    const rows = withProvisionalIds(
      ownershipRowsOf([row({ key: "a", pct: "50", draft: blankOwnerDraft("A") }), row({ key: "b", pct: "50", is_primary: false, draft: blankOwnerDraft("B") })]),
    );
    expect(rows.map((r) => r.owner_id)).toEqual(["nuevo:a", "nuevo:b"]);
  });
});

describe("borrador de la propiedad", () => {
  it("recupera lo tipeado, incluido el propietario nuevo a medio cargar", () => {
    const stored = {
      street: "Dean Funes",
      street_number: "450",
      property_type: "casa",
      furnished: true,
      owners: [{ owner_id: "", pct: "100", is_primary: true, draft: { full_name: "Ulises Rojas", phone: "351", email: "", cbu: "", alias_cbu: "" } }],
      services: [{ kind: "luz", provider: "EPEC", account_number: "123", holder: null, notes: null }],
    };
    const state = propertyStateFromDraft(blank(), stored);
    expect(state.street).toBe("Dean Funes");
    expect(state.property_type).toBe("casa");
    expect(state.furnished).toBe(true);
    expect(state.owners[0].draft?.full_name).toBe("Ulises Rojas");
    expect(state.owners[0].key).toBeTruthy();
    expect(state.services[0]).toMatchObject({ kind: "luz", provider: "EPEC", account_number: "123" });
    expect(sameFormValues(state, blank())).toBe(false);
  });

  it("lo que no encaja queda como en un alta vacía", () => {
    const state = propertyStateFromDraft(blank(), {
      property_type: "castillo",
      availability: 3,
      listing_currency: "EUR",
      owners: [],
      services: [{ kind: "telepatia" }, "x"],
      furnished: "sí",
    });
    expect(sameFormValues(state, blank())).toBe(true);
  });

  it("las filas de dueños siempre tienen un principal", () => {
    const rows = ownerRowsFromDraft([
      { owner_id: "o1", pct: "50", is_primary: false },
      { owner_id: "o2", pct: "50", is_primary: false },
    ]);
    expect(rows?.map((r) => r.is_primary)).toEqual([true, false]);
    expect(ownerRowsFromDraft("x")).toBeUndefined();
    expect(serviceRowsFromDraft(null)).toBeUndefined();
  });

  it("suelta a un propietario que ya no está en la lista", () => {
    const rows = dropUnknownOwners([row({ key: "a", owner_id: "o1" }), row({ key: "b", owner_id: "borrado" })], new Set(["o1"]));
    expect(rows.map((r) => r.owner_id)).toEqual(["o1", ""]);
  });
});
