import { describe, expect, it } from "vitest";
import { decodeDraft, draftStorageKey, encodeDraft, mergeDraft, oneOf, sameFormValues, withoutRowKeys } from "../form-draft";

describe("sameFormValues", () => {
  it("ignora los ids de fila y el orden de las claves", () => {
    const a = { street: "Dean Funes", owners: [{ key: "k1", owner_id: "o1", pct: "100", is_primary: true }] };
    const b = { owners: [{ is_primary: true, pct: "100", owner_id: "o1", key: "k99" }], street: "Dean Funes" };
    expect(sameFormValues(a, b)).toBe(true);
  });

  it("un campo ausente, undefined o null cuentan igual", () => {
    expect(sameFormValues({ owners: [{ key: "a", owner_id: "", draft: null }] }, { owners: [{ key: "b", owner_id: "" }] })).toBe(true);
    expect(sameFormValues({ x: undefined }, {})).toBe(true);
  });

  it("detecta lo tipeado, también adentro de una fila", () => {
    expect(sameFormValues({ street: "" }, { street: "D" })).toBe(false);
    expect(sameFormValues({ furnished: false }, { furnished: true })).toBe(false);
    const blank = { owners: [{ key: "a", owner_id: "", pct: "100", is_primary: true, draft: null }] };
    const typed = { owners: [{ key: "a", owner_id: "", pct: "100", is_primary: true, draft: { full_name: "Ulises" } }] };
    expect(sameFormValues(blank, typed)).toBe(false);
    expect(sameFormValues({ services: [] }, { services: [{ key: "s", kind: "luz" }] })).toBe(false);
  });

  it("no confunde un texto vacío con un valor ausente", () => {
    expect(sameFormValues({ street: "" }, {})).toBe(false);
  });
});

describe("withoutRowKeys", () => {
  it("saca sólo el key de las filas, no un campo key de primer nivel", () => {
    expect(withoutRowKeys({ key: "x", rows: [{ key: "k", a: 1 }] })).toEqual({ key: "x", rows: [{ a: 1 }] });
  });
});

describe("encodeDraft / decodeDraft", () => {
  it("ida y vuelta sin los ids de fila", () => {
    const raw = encodeDraft({ street: "Colón", owners: [{ key: "k1", owner_id: "o1" }] }, new Date("2026-10-05T17:20:00Z"));
    expect(decodeDraft(raw)).toEqual({ savedAt: "2026-10-05T17:20:00.000Z", form: { street: "Colón", owners: [{ owner_id: "o1" }] } });
  });

  it("descarta lo roto o de otra versión", () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft("")).toBeNull();
    expect(decodeDraft("{no es json")).toBeNull();
    expect(decodeDraft(JSON.stringify({ v: 2, savedAt: "x", form: {} }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ v: 1, savedAt: "x", form: [] }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ v: 1, form: {} }))).toBeNull();
    expect(decodeDraft("null")).toBeNull();
  });
});

describe("mergeDraft", () => {
  const blank = { name: "", count: "", furnished: false, kind: "departamento" as "departamento" | "casa", rows: [] as { a: string }[] };

  it("toma sólo los campos conocidos y del mismo tipo", () => {
    const merged = mergeDraft(blank, { name: "Ana", furnished: "sí", extra: 1, count: 3 });
    expect(merged).toEqual({ ...blank, name: "Ana" });
  });

  it("las listas y los menús pasan por su arreglo", () => {
    const fixes = {
      kind: oneOf(["departamento", "casa"] as const),
      rows: (v: unknown) => (Array.isArray(v) ? v.filter((r): r is { a: string } => typeof r?.a === "string") : undefined),
    };
    expect(mergeDraft(blank, { kind: "casa", rows: [{ a: "1" }, { b: 2 }, null] }, fixes)).toEqual({ ...blank, kind: "casa", rows: [{ a: "1" }] });
    expect(mergeDraft(blank, { kind: "castillo", rows: "x" }, fixes)).toEqual(blank);
  });

  it("sin arreglo, una lista guardada se ignora", () => {
    expect(mergeDraft(blank, { rows: [{ a: "1" }] })).toEqual(blank);
  });
});

describe("draftStorageKey", () => {
  it("separa por tipo, organización y usuario", () => {
    expect(draftStorageKey("propiedad", "org1", "u1")).not.toBe(draftStorageKey("propiedad", "org2", "u1"));
    expect(draftStorageKey("propiedad", "org1", "u1")).not.toBe(draftStorageKey("propiedad", "org1", "u2"));
    expect(draftStorageKey("persona.inquilino", "org1", "u1")).not.toBe(draftStorageKey("persona.garante", "org1", "u1"));
  });
});
