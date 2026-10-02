import { describe, expect, it } from "vitest";
import {
  adjustmentExplanation,
  adjustmentSummary,
  daysUntil,
  dueInWords,
  formatPctAr,
  monthSpanLabel,
  parsePaymentInstructions,
} from "../portal-helpers";

describe("monthSpanLabel", () => {
  it("cuenta desde el mes siguiente a la base hasta el último dato", () => {
    // Base enero, último dato abril → la inflación de febrero, marzo y abril.
    expect(monthSpanLabel("2026-01-01", "2026-04-01")).toBe("febrero a abril de 2026");
  });
  it("cruza el año diciendo los dos años", () => {
    expect(monthSpanLabel("2025-10-01", "2026-01-01")).toBe("noviembre de 2025 a enero de 2026");
  });
  it("un solo mes", () => {
    expect(monthSpanLabel("2026-02-01", "2026-03-01")).toBe("marzo de 2026");
  });
});

describe("adjustmentExplanation", () => {
  it("IPC: porcentaje y meses medidos", () => {
    expect(
      adjustmentExplanation({ method: "indice", indexCode: "ipc", variationPct: 8.72, fromKey: "2026-01-01", toKey: "2026-04-01" }),
    ).toBe("Subió un 8,7 % según el IPC de febrero a abril de 2026.");
  });
  it("ICL (diario): entre dos fechas", () => {
    expect(
      adjustmentExplanation({ method: "indice", indexCode: "icl", variationPct: 12.3, fromKey: "2026-03-01", toKey: "2026-06-01" }),
    ).toBe("Subió un 12,3 % según el ICL entre el 01/03/2026 y el 01/06/2026.");
  });
  it("porcentaje fijo y baja", () => {
    expect(adjustmentExplanation({ method: "porcentaje_fijo", indexCode: null, variationPct: 5, fromKey: null, toKey: null })).toBe(
      "Subió un 5 %, como dice el contrato.",
    );
    expect(adjustmentExplanation({ method: "manual", indexCode: null, variationPct: -2, fromKey: null, toKey: null })).toBe(
      "Bajó un 2 %: es el monto acordado.",
    );
  });
});

describe("adjustmentSummary", () => {
  it("describe la frecuencia y el índice", () => {
    expect(adjustmentSummary({ method: "indice", indexCode: "ipc", every: 3, fixedPct: null })).toBe("Se actualiza cada 3 meses por IPC");
    expect(adjustmentSummary({ method: "indice", indexCode: "icl", every: 12, fixedPct: null })).toBe("Se actualiza una vez por año por ICL");
    expect(adjustmentSummary({ method: "porcentaje_fijo", indexCode: null, every: 4, fixedPct: 7.5 })).toBe("Sube un 7,5 % cada 4 meses");
    expect(adjustmentSummary({ method: "sin_ajuste", indexCode: null, every: null, fixedPct: null })).toBe("Precio fijo durante todo el contrato");
  });
});

describe("parsePaymentInstructions", () => {
  it("detecta CBU, alias y CUIT para copiarlos", () => {
    const lines = parsePaymentInstructions(
      "Transferí a Inmobiliaria Centro SRL\nCBU: 0070 1234 5678 9012 3456 78\nAlias: inmo.centro.alq\nCUIT 30-71234567-9\n\nBanco Galicia",
    );
    expect(lines.map((l) => l.copy)).toEqual([
      null,
      { label: "CBU", value: "0070123456789012345678" },
      { label: "Alias", value: "inmo.centro.alq" },
      { label: "CUIT", value: "30712345679" },
      null,
    ]);
  });
  it("vacío → sin renglones", () => {
    expect(parsePaymentInstructions(null)).toEqual([]);
  });
});

describe("fechas y porcentajes", () => {
  it("dice el vencimiento en palabras", () => {
    expect(dueInWords("2026-10-02", "2026-10-02")).toBe("vence hoy");
    expect(dueInWords("2026-10-02", "2026-10-03")).toBe("vence mañana");
    expect(dueInWords("2026-10-02", "2026-10-10")).toBe("vence en 8 días");
    expect(dueInWords("2026-10-02", "2026-10-01")).toBe("venció ayer");
    expect(dueInWords("2026-10-12", "2026-10-02")).toBe("venció hace 10 días");
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("formatea porcentajes en es-AR", () => {
    expect(formatPctAr(8.72)).toBe("8,7 %");
    expect(formatPctAr(null)).toBe("—");
  });
});

describe("readableTextOn", () => {
  it("blanco sobre colores oscuros, oscuro sobre colores claros", async () => {
    const { readableTextOn } = await import("../portal-helpers");
    expect(readableTextOn("#0F766E")).toBe("#ffffff");
    expect(readableTextOn("#1e3a8a")).toBe("#ffffff");
    expect(readableTextOn("#facc15")).toBe("#111827");
    expect(readableTextOn("#ffffff")).toBe("#111827");
    expect(readableTextOn("nada")).toBe("#ffffff");
  });
});
