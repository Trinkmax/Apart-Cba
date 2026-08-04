import { describe, it, expect } from "vitest";
import {
  formatPeriodCycle,
  formatPeriodFull,
  nextPeriodInCycle,
} from "../labels";
import { buildStatementModel, type StatementInput } from "../statement-model";

/**
 * Período del ciclo de ajuste por IPC (migración 046). Cubre las etiquetas
 * puras y que el dato efectivamente llegue al modelo del documento — que es
 * la única fuente de la pantalla, el PDF, el Excel y el link público.
 */

describe("formatPeriodCycle", () => {
  it("arma 'Período 1/3' con índice y ciclo", () => {
    expect(formatPeriodCycle(1, 3)).toBe("Período 1/3");
    expect(formatPeriodCycle(3, 3)).toBe("Período 3/3");
  });

  it("omite el denominador si no hay ciclo", () => {
    expect(formatPeriodCycle(2, null)).toBe("Período 2");
    expect(formatPeriodCycle(2, 0)).toBe("Período 2");
  });

  it("devuelve null cuando no hay período cargado", () => {
    expect(formatPeriodCycle(null, 3)).toBeNull();
    expect(formatPeriodCycle(undefined, undefined)).toBeNull();
    expect(formatPeriodCycle(0, 3)).toBeNull();
  });
});

describe("formatPeriodFull", () => {
  it("concatena mes y período", () => {
    expect(formatPeriodFull(2026, 7, 1, 3)).toBe("Julio 2026 · Período 1/3");
  });

  it("cae al mes solo si no hay período", () => {
    expect(formatPeriodFull(2026, 7, null, null)).toBe("Julio 2026");
  });
});

describe("nextPeriodInCycle", () => {
  it("avanza dentro del ciclo", () => {
    expect(nextPeriodInCycle(1, 3)).toBe(2);
    expect(nextPeriodInCycle(2, 3)).toBe(3);
  });

  it("vuelve a 1 al cerrar el ciclo (ahí se aplica el ajuste)", () => {
    expect(nextPeriodInCycle(3, 3)).toBe(1);
  });

  it("sin ciclo simplemente incrementa", () => {
    expect(nextPeriodInCycle(4, null)).toBe(5);
  });

  it("respeta los meses salteados", () => {
    // Junio fue 1/3 y no hubo liquidación en julio: agosto es 3/3, no 2/3.
    expect(nextPeriodInCycle(1, 3, 2)).toBe(3);
    // Un salto que cruza el fin de ciclo vuelve a empezar.
    expect(nextPeriodInCycle(2, 3, 2)).toBe(1);
    // Un año entero de hueco con ciclo trimestral cae en el mismo período.
    expect(nextPeriodInCycle(2, 3, 12)).toBe(2);
  });

  it("nunca devuelve algo fuera del ciclo", () => {
    for (let cycle = 1; cycle <= 6; cycle++) {
      for (let index = 1; index <= cycle; index++) {
        for (let steps = 1; steps <= 15; steps++) {
          const n = nextPeriodInCycle(index, cycle, steps);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(cycle);
        }
      }
    }
  });
});

function baseInput(over: Partial<StatementInput> = {}): StatementInput {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    period_year: 2026,
    period_month: 7,
    status: "borrador",
    currency: "ARS",
    gross_revenue: 0,
    commission_amount: 0,
    deductions_amount: 0,
    net_payable: 0,
    owner: { full_name: "Juan Pérez" },
    lines: [],
    ...over,
  };
}

describe("buildStatementModel · período del ciclo", () => {
  it("expone las etiquetas cuando el período está cargado", () => {
    const m = buildStatementModel(
      baseInput({
        period_index: 1,
        period_cycle: 3,
        period_note: "incluye reintegro de expensas",
      }),
    );
    expect(m.periodLabel).toBe("Julio 2026");
    expect(m.periodCycleLabel).toBe("Período 1/3");
    expect(m.periodFullLabel).toBe("Julio 2026 · Período 1/3");
    expect(m.periodNote).toBe("incluye reintegro de expensas");
    expect(m.periodIndex).toBe(1);
    expect(m.periodCycle).toBe(3);
  });

  it("es inocuo para liquidaciones viejas sin período", () => {
    const m = buildStatementModel(baseInput());
    expect(m.periodCycleLabel).toBeNull();
    expect(m.periodFullLabel).toBe("Julio 2026");
    expect(m.periodNote).toBeNull();
  });

  it("normaliza una nota en blanco a null (no imprime una línea vacía)", () => {
    const m = buildStatementModel(
      baseInput({ period_index: 2, period_cycle: 3, period_note: "   " }),
    );
    expect(m.periodNote).toBeNull();
  });
});

describe("documentos exportables", () => {
  const branding = {
    name: "Apart Cba",
    legal_name: null,
    tax_id: null,
    logo_url: null,
    primary_color: "#0F766E",
  };

  it("el PDF se genera con y sin período (no rompe el layout)", async () => {
    const { buildSettlementDoc } = await import("@/lib/pdf/settlement-pdf");

    const conPeriodo = await buildSettlementDoc(
      buildStatementModel(
        baseInput({
          period_index: 2,
          period_cycle: 3,
          period_note: "incluye reintegro de expensas de junio",
        }),
      ),
      branding,
    );
    const sinPeriodo = await buildSettlementDoc(
      buildStatementModel(baseInput()),
      branding,
    );

    const conBytes = conPeriodo.output("arraybuffer").byteLength;
    const sinBytes = sinPeriodo.output("arraybuffer").byteLength;
    expect(conBytes).toBeGreaterThan(1000);
    // El documento con período imprime texto extra → pesa más.
    expect(conBytes).toBeGreaterThan(sinBytes);
  });

  it("el Excel escribe el período en el título y la nota debajo", async () => {
    const { buildSettlementWorkbook } = await import(
      "@/lib/excel/settlement-xlsx"
    );
    const wb = buildSettlementWorkbook(
      buildStatementModel(
        baseInput({
          period_index: 2,
          period_cycle: 3,
          period_note: "incluye reintegro de expensas",
        }),
      ),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    expect(String(ws.getCell(2, 1).value)).toContain("Período 2/3");
    expect(String(ws.getCell(4, 1).value)).toBe(
      "incluye reintegro de expensas",
    );
    // El panel congelado tiene que correrse con la fila extra de la nota.
    expect(ws.views[0]).toMatchObject({ ySplit: 5 });
  });

  it("la nota larga se envuelve en el Excel en vez de recortarse", async () => {
    const { buildSettlementWorkbook } = await import(
      "@/lib/excel/settlement-xlsx"
    );
    const larga = "x".repeat(160);
    const wb = buildSettlementWorkbook(
      buildStatementModel(
        baseInput({ period_index: 1, period_cycle: 3, period_note: larga }),
      ),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    const cell = ws.getCell(4, 1);
    expect(String(cell.value)).toHaveLength(160);
    expect(cell.alignment?.wrapText).toBe(true);
    expect(ws.getRow(4).height).toBeGreaterThan(18);
  });

  it("sin nota el Excel mantiene el freeze original", async () => {
    const { buildSettlementWorkbook } = await import(
      "@/lib/excel/settlement-xlsx"
    );
    const wb = buildSettlementWorkbook(
      buildStatementModel(baseInput({ period_index: 1, period_cycle: 3 })),
      branding,
    );
    const ws = wb.getWorksheet("Liquidación")!;
    expect(ws.views[0]).toMatchObject({ ySplit: 4 });
  });
});
