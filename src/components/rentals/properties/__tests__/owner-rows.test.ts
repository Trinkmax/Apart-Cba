import { describe, expect, it } from "vitest";
import {
  adoptCreatedOwners,
  archivedOwnerMessage,
  blankOwnerDraft,
  draftHasData,
  findOwnerByName,
  newOwnerNameProblem,
  ownerDetails,
  sameOwnerRows,
  undoOwnerDiscard,
  type OwnershipRow,
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

describe("Deshacer en el bloque de propietarios", () => {
  it("compara filas por lo que tienen, no por referencia", () => {
    const a = [row("a", { owner_id: "o1", pct: "100", is_primary: true }), row("b", { draft: { ...blankOwnerDraft("Ana"), id: "d1" } })];
    const b = a.map((r) => ({ ...r, draft: r.draft ? { ...r.draft } : null }));
    expect(sameOwnerRows(a, b)).toBe(true);
    expect(sameOwnerRows(a, [a[0]])).toBe(false);
    expect(sameOwnerRows(a, [a[0], { ...a[1], pct: "40" }])).toBe(false);
    expect(sameOwnerRows(a, [a[0], { ...a[1], draft: { ...a[1].draft!, cbu: "1" } }])).toBe(false);
  });
});

describe("nombre repetido antes de crear a nadie", () => {
  const ownership = (key: string, patch: Partial<OwnershipRow> = {}): OwnershipRow => ({ key, owner_id: "", ownership_pct: 50, is_primary: false, draft: null, ...patch });
  const draft = (id: string, full_name: string) => ({ ...blankOwnerDraft(full_name), id });

  it("mira a TODOS los nuevos: el segundo con nombre de un archivado frena antes de crear al primero", () => {
    const rows = [ownership("a", { draft: draft("d1", "Ana López") }), ownership("b", { draft: draft("d2", "Ulises Rojas") })];
    const res = newOwnerNameProblem(rows, [owner("o1", "Pedro Gómez")], [owner("x1", "ULISES ROJAS")]);
    expect(res).toEqual({ rowKey: "b", existing: null, message: archivedOwnerMessage({ full_name: "ULISES ROJAS" }) });
    expect(res?.message).toContain("archivado");
    expect(res?.message).toContain("segundo apellido");
  });

  it("uno de la lista: ofrece usar ese, o quitar la fila si ya está elegido en otra", () => {
    const juan = owner("o1", "Juan Pérez");
    const free = newOwnerNameProblem([ownership("a", { draft: draft("d1", "juan perez") })], [juan], []);
    expect(free).toMatchObject({ rowKey: "a", existing: juan });
    expect(free?.message).toContain("«Usar ese propietario»");
    const taken = newOwnerNameProblem([ownership("a", { owner_id: "o1" }), ownership("b", { draft: draft("d1", "Juan Pérez") })], [juan], []);
    expect(taken?.message).toContain("quitá esta fila");
  });

  it("no cuenta al que la misma fila ya creó (respuesta perdida), ni sin listas", () => {
    const rows = [ownership("a", { draft: draft("d1", "Ana López") })];
    expect(newOwnerNameProblem(rows, [owner("d1", "Ana López")], [])).toBeNull();
    expect(newOwnerNameProblem(rows, null, null)).toBeNull();
  });
});
