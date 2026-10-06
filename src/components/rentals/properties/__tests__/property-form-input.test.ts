import { describe, expect, it } from "vitest";
import { formDiffsFromSaved, parsePropertyForm } from "../property-form-input";
import { blankOwnerDraft } from "../owner-rows";
import type { RentalProperty } from "@/lib/types/database";
import type { PropertyFormState } from "../property-form";

const blank: PropertyFormState = {
  client_id: "11111111-1111-4111-8111-111111111111",
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
  owners: [],
  created_owners: [],
};

describe("parsePropertyForm", () => {
  it("frena en lo que el servidor también rechazaría, con el campo a marcar", () => {
    expect(parsePropertyForm(blank, false)).toEqual({ ok: false, field: "street", message: "Escribí la calle." });
    const withStreet = { ...blank, street: "Dean Funes" };
    expect(parsePropertyForm({ ...withStreet, rooms: "2,5" }, false)).toMatchObject({ ok: false, field: "rooms" });
    expect(parsePropertyForm({ ...withStreet, covered_m2: "0" }, false)).toMatchObject({ ok: false, field: "covered_m2" });
    expect(parsePropertyForm({ ...withStreet, listing_rent: "mucho" }, false)).toMatchObject({ ok: false, field: "listing_rent" });
  });

  it("arma lo que se manda: textos recortados, vacíos en null, montos en número", () => {
    const res = parsePropertyForm(
      {
        ...blank,
        street: "  Dean Funes ",
        street_number: "450",
        floor: " ",
        rooms: "2",
        covered_m2: "45,5",
        listing_rent: "450.000",
        services: [
          { key: "a", kind: "luz", provider: " EPEC ", account_number: null, holder: null, notes: null },
          { key: "b", kind: "gas", provider: "", account_number: null, holder: null, notes: null },
        ],
      },
      false,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.base).toMatchObject({
      id: blank.client_id,
      street: "Dean Funes",
      street_number: "450",
      floor: null,
      rooms: 2,
      covered_m2: 45.5,
      listing_rent: 450000,
      listing_currency: "ARS",
      services: [{ kind: "luz", provider: "EPEC", account_number: null, holder: null, notes: null }],
    });
  });

  it("al editar no manda id; sin precio, sin moneda", () => {
    const res = parsePropertyForm({ ...blank, street: "Colón" }, true);
    expect(res.ok && res.base.id).toBeNull();
    expect(res.ok && res.base.listing_currency).toBeNull();
  });
});

describe("formDiffsFromSaved (un borrador cuya propiedad ya quedó guardada)", () => {
  const OWNER = "22222222-2222-4222-8222-222222222222";
  const NEW_OWNER = "33333333-3333-4333-8333-333333333333";
  const form: PropertyFormState = {
    ...blank,
    street: "Dean Funes",
    street_number: "450",
    owners: [{ key: "a", owner_id: "", pct: "100", is_primary: true, draft: { ...blankOwnerDraft("Ana López"), id: NEW_OWNER } }],
  };
  const parsed = parsePropertyForm(form, false);
  if (!parsed.ok) throw new Error("el formulario de prueba tiene que ser válido");
  // Lo que quedó guardado: lo mismo que se mandó, con el código que le puso el servidor.
  const property = { ...parsed.base, code: "DEANFUNES450" } as unknown as RentalProperty;

  it("el propietario nuevo que se creó con su id y quedó en la propiedad es el mismo: nada distinto", () => {
    expect(formDiffsFromSaved(form, { property, owners: [{ owner_id: NEW_OWNER, ownership_pct: 100, is_primary: true }] })).toEqual([]);
  });

  it("si después se cambió algo, lo dice", () => {
    expect(formDiffsFromSaved({ ...form, floor: "3" }, { property, owners: [{ owner_id: NEW_OWNER, ownership_pct: 100, is_primary: true }] })).toEqual(["la dirección"]);
    expect(formDiffsFromSaved(form, { property, owners: [{ owner_id: OWNER, ownership_pct: 100, is_primary: true }] })).toEqual(["los propietarios"]);
    expect(formDiffsFromSaved({ ...form, covered_m2: "abc" }, { property, owners: [] })).toEqual(["algunos datos"]);
  });
});
