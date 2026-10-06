import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPropertyInput, checkQuickOwnerInput, isUuid, newClientId, OTHER_PERSON_HINT } from "../property-input";

const OWNER = "5b8f9a3e-2c1d-4e7f-9a0b-1c2d3e4f5a6b";

const base = {
  code: "",
  property_type: "departamento",
  street: "Dean Funes",
  street_number: "450",
  floor: null,
  apartment: null,
  tower: null,
  neighborhood: null,
  city: "Córdoba",
  province: "Córdoba",
  postal_code: null,
  rooms: null,
  bedrooms: null,
  bathrooms: null,
  covered_m2: null,
  total_m2: null,
  furnished: false,
  has_garage: false,
  consortium_name: null,
  consortium_phone: null,
  consortium_email: null,
  functional_unit: null,
  cadastral_id: null,
  services: [],
  listing_rent: null,
  listing_currency: null,
  availability: "disponible",
  mandate_signed_at: null,
  notes: null,
  owners: [{ owner_id: OWNER, ownership_pct: 100, is_primary: true }],
};

describe("newClientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("da un UUID v4 distinto cada vez", () => {
    const a = newClientId();
    const b = newClientId();
    expect(isUuid(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a[14]).toBe("4");
  });

  it("anda sin randomUUID (http por la IP de la red): usa getRandomValues", () => {
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => b.fill(7) });
    const id = newClientId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });
});

describe("checkPropertyInput", () => {
  it("una propiedad mínima pasa", () => {
    const res = checkPropertyInput({ ...base, id: OWNER });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(OWNER);
  });

  it("encuentra lo que el servidor rechazaría, antes de crear a nadie", () => {
    expect(checkPropertyInput({ ...base, floor: "x".repeat(31) })).toEqual({ ok: false, field: "floor", error: "Piso: hasta 30 caracteres." });
    expect(checkPropertyInput({ ...base, consortium_email: "admin@" })).toMatchObject({ ok: false, field: "consortium_email" });
    expect(checkPropertyInput({ ...base, mandate_signed_at: "2026-02-30" })).toMatchObject({ ok: false, field: "mandate_signed_at" });
    expect(checkPropertyInput({ ...base, street: "D" })).toMatchObject({ ok: false, field: "street", error: "Escribí la calle." });
  });

  it("«Planta baja» y un depto. largo entran (antes el campo los cortaba a 10)", () => {
    const res = checkPropertyInput({ ...base, floor: "Planta baja", apartment: "Local 3 - Galería" });
    expect(res).toMatchObject({ ok: true, data: { floor: "Planta baja", apartment: "Local 3 - Galería" } });
  });

  it("un error de un servicio se marca en la sección", () => {
    const res = checkPropertyInput({ ...base, services: [{ kind: "luz", provider: "x".repeat(81), account_number: null, holder: null, notes: null }] });
    expect(res).toMatchObject({ ok: false, field: "services" });
  });

  it("un propietario nuevo valida con su id provisorio", () => {
    expect(checkPropertyInput({ ...base, owners: [{ owner_id: "", ownership_pct: 100, is_primary: true }] })).toMatchObject({ ok: false, field: "owners" });
  });

  it("un id que no sirve no bloquea el guardado", () => {
    const res = checkPropertyInput({ ...base, id: "no-es-un-id" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBeNull();
  });
});

describe("checkQuickOwnerInput", () => {
  it("limpia el CBU y pasa el mail a minúsculas", () => {
    const res = checkQuickOwnerInput({ id: OWNER, full_name: " Ulises Rojas ", phone: null, email: "U@X.COM", cbu: "0110 5995 2000 0012 3456 78", alias_cbu: null });
    expect(res).toMatchObject({ ok: true, data: { id: OWNER, full_name: "Ulises Rojas", email: "u@x.com", cbu: "0110599520000012345678" } });
  });

  it("rechaza un CBU corto o un alias inválido, en su campo", () => {
    expect(checkQuickOwnerInput({ full_name: "Ana", phone: null, email: null, cbu: "123", alias_cbu: null })).toMatchObject({ ok: false, field: "cbu" });
    expect(checkQuickOwnerInput({ full_name: "Ana", phone: null, email: null, cbu: null, alias_cbu: "a b" })).toMatchObject({ ok: false, field: "alias_cbu" });
    expect(checkQuickOwnerInput({ full_name: "A", phone: null, email: null, cbu: null, alias_cbu: null })).toMatchObject({ ok: false, field: "full_name" });
  });
});

it("la salida para un homónimo dice qué hacer", () => {
  expect(OTHER_PERSON_HINT).toMatch(/segundo apellido/);
});
