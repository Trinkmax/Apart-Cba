import { describe, expect, it } from "vitest";
import {
  REVERT_KEEP_LABEL,
  revertKeepReason,
  summarizePeriodRevert,
  type PeriodRevertCandidate,
} from "../period-revert";

function candidate(overrides: Partial<PeriodRevertCandidate> = {}): PeriodRevertCandidate {
  return {
    id: "s1",
    status: "borrador",
    origin: "auto",
    paid_movement_id: null,
    last_edited_by: null,
    has_manual_lines: false,
    has_edits: false,
    net_payable: 1000,
    currency: "ARS",
    owner_name: "Ana",
    ...overrides,
  };
}

describe("revertKeepReason", () => {
  it("un borrador automático sin tocar se puede borrar", () => {
    expect(revertKeepReason(candidate())).toBeNull();
  });

  it("nada que haya salido de acá se borra en lote", () => {
    expect(revertKeepReason(candidate({ status: "pagada" }))).toBe("pagada");
    expect(revertKeepReason(candidate({ status: "enviada" }))).toBe("enviada");
    expect(revertKeepReason(candidate({ status: "disputada" }))).toBe("disputada");
    expect(revertKeepReason(candidate({ status: "revisada" }))).toBe("revisada");
  });

  it("un egreso en Caja manda, aunque el estado diga otra cosa", () => {
    expect(revertKeepReason(candidate({ paid_movement_id: "m1" }))).toBe("pagada");
  });

  it("no se pierde el trabajo de una persona", () => {
    expect(revertKeepReason(candidate({ origin: "manual" }))).toBe("manual");
    expect(revertKeepReason(candidate({ has_manual_lines: true }))).toBe("editada");
    expect(revertKeepReason(candidate({ has_edits: true }))).toBe("editada");
    expect(revertKeepReason(candidate({ last_edited_by: "u1" }))).toBe("editada");
  });

  it("ante un estado o un origen desconocido, no borra", () => {
    expect(revertKeepReason(candidate({ status: "otro" }))).toBe("revisada");
    expect(revertKeepReason(candidate({ origin: null }))).toBe("manual");
  });

  it("cada motivo tiene su texto", () => {
    for (const reason of ["pagada", "enviada", "disputada", "revisada", "manual", "editada"] as const) {
      expect(REVERT_KEEP_LABEL[reason]).toBeTruthy();
    }
  });
});

describe("summarizePeriodRevert", () => {
  it("separa lo que se borra de lo que queda, y dice por qué", () => {
    const preview = summarizePeriodRevert([
      candidate({ id: "a", net_payable: 1000 }),
      candidate({ id: "b", net_payable: 500 }),
      candidate({ id: "c", status: "enviada", owner_name: "Zoe" }),
      candidate({ id: "d", has_manual_lines: true, owner_name: "Beto" }),
    ]);
    expect(preview.ids).toEqual(["a", "b"]);
    expect(preview.totals).toEqual([{ currency: "ARS", amount: 1500 }]);
    expect(preview.kept).toEqual([
      { id: "d", owner_name: "Beto", reason: "editada" },
      { id: "c", owner_name: "Zoe", reason: "enviada" },
    ]);
  });

  it("no suma lo que queda en el total a eliminar", () => {
    const preview = summarizePeriodRevert([candidate({ status: "pagada", net_payable: 999 })]);
    expect(preview.ids).toEqual([]);
    expect(preview.totals).toEqual([]);
  });

  it("no mezcla monedas", () => {
    const preview = summarizePeriodRevert([
      candidate({ id: "a", net_payable: 1000 }),
      candidate({ id: "b", net_payable: 50, currency: "USD" }),
    ]);
    expect(preview.totals).toEqual([
      { currency: "ARS", amount: 1000 },
      { currency: "USD", amount: 50 },
    ]);
  });
});
