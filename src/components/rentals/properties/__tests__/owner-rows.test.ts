import { describe, expect, it } from "vitest";
import {
  adoptCreatedOwners,
  blankOwnerDraft,
  draftHasData,
  findOwnerByName,
  ownerDetails,
  undoOwnerDiscard,
  type OwnerRowState,
} from "../owner-rows";
import type { OwnerOption } from "../property-types";

const owner = (id: string, full_name: string, extra: Partial<OwnerOption> = {}): OwnerOption => ({
  id,
  full_name,
  phone: null,
  email: null,
  document_number: null,
  ...extra,
});
const row = (key: string, patch: Partial<OwnerRowState> = {}): OwnerRowState => ({ key, owner_id: "", pct: "", is_primary: false, draft: null, ...patch });

describe("propietario nuevo de una fila", () => {
  it("cada borrador nace con su propio id (para que reintentar no lo duplique)", () => {
    const a = blankOwnerDraft("  Ana Díaz ");
    const b = blankOwnerDraft();
    expect(a.full_name).toBe("Ana Díaz");
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.id).not.toBe(b.id);
  });

  it("sabe si hay algo tipeado (para no tirarlo en silencio)", () => {
    expect(draftHasData(null)).toBe(false);
    expect(draftHasData(blankOwnerDraft())).toBe(false);
    expect(draftHasData({ ...blankOwnerDraft(), phone: "   " })).toBe(false);
    expect(draftHasData(blankOwnerDraft("Ana"))).toBe(true);
    expect(draftHasData({ ...blankOwnerDraft(), cbu: "0000003100010000000001" })).toBe(true);
  });
});

describe("homónimos", () => {
  it("muestra teléfono, mail y DNI del que ya está", () => {
    expect(ownerDetails(owner("o1", "Ana", { phone: "351 555 1234", email: "ana@mail.com", document_number: "20123456" }))).toBe(
      "351 555 1234 · ana@mail.com · DNI 20123456",
    );
    expect(ownerDetails(owner("o1", "Ana"))).toBe("");
  });

  it("el propietario que la misma fila ya creó no cuenta como homónimo", () => {
    const options = [owner("o1", "María González")];
    expect(findOwnerByName(options, "maria gonzalez")?.id).toBe("o1");
    expect(findOwnerByName(options, "maria gonzalez", "o1")).toBeNull();
  });
});

describe("adoptCreatedOwners", () => {
  it("una fila cuyo propietario nuevo ya existe (respuesta perdida) pasa a tenerlo elegido", () => {
    const draft = blankOwnerDraft("Ana Díaz");
    const rows = [row("a", { owner_id: "o9" }), row("b", { draft })];
    const created = owner(draft.id, "Ana Díaz");
    const out = adoptCreatedOwners(rows, [owner("o9", "Otro"), created]);
    expect(out.adopted).toEqual([created]);
    expect(out.rows[1]).toMatchObject({ key: "b", owner_id: draft.id, draft: null });
    expect(out.rows[0]).toBe(rows[0]);
  });

  it("si no hay nada que adoptar devuelve las mismas filas", () => {
    const rows = [row("a", { draft: blankOwnerDraft("Ana") })];
    const out = adoptCreatedOwners(rows, [owner("o1", "Ana")]);
    expect(out.adopted).toEqual([]);
    expect(out.rows).toBe(rows);
  });
});

describe("undoOwnerDiscard", () => {
  const draft = { ...blankOwnerDraft("Ana Díaz"), phone: "351 555 1234" };
  const before = [row("a", { owner_id: "o1", pct: "50", is_primary: true }), row("b", { pct: "50", draft })];

  it("si nada cambió desde que se tiró, vuelve todo como estaba", () => {
    const after = [{ ...before[0], pct: "100" }];
    expect(undoOwnerDiscard(after, { before, after, key: "b" })).toBe(before);
  });

  it("si entretanto se tocó otra cosa, sólo devuelve la fila tirada, en su lugar", () => {
    const after = [before[0], { ...before[1], draft: null }];
    const current = [{ ...before[0], pct: "40" }, { ...before[1], draft: null }];
    const out = undoOwnerDiscard(current, { before, after, key: "b" });
    expect(out.map((r) => [r.key, r.pct, r.draft?.full_name ?? null])).toEqual([
      ["a", "40", null],
      ["b", "50", "Ana Díaz"],
    ]);
  });

  it("una fila quitada vuelve en su lugar y queda un solo principal", () => {
    const primaryDraftRow = row("b", { pct: "50", is_primary: true, draft });
    const before2 = [row("a", { owner_id: "o1", pct: "50" }), primaryDraftRow, row("c", { owner_id: "o2" })];
    const after = [{ ...before2[0], is_primary: true }, before2[2]];
    const current = [{ ...before2[0], is_primary: true, pct: "70" }, before2[2]];
    const out = undoOwnerDiscard(current, { before: before2, after, key: "b" });
    expect(out.map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(out.filter((r) => r.is_primary).map((r) => r.key)).toEqual(["b"]);
  });
});
