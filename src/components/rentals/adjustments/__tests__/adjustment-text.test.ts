import { describe, expect, it } from "vitest";
import {
  adjustmentBasisText,
  adjustmentMethodLine,
  adjustmentSentence,
  adjustmentWhatsappText,
  firstNameOf,
  formatVariation,
  frequencyLabel,
  longDate,
  monthsUsed,
  monthsUsedLong,
  monthsUsedShort,
  plainMoney,
  waitingForIndexText,
  type NoticeInput,
} from "@/components/rentals/adjustments/adjustment-text";

const ipc: NoticeInput = {
  method: "indice",
  index_code: "ipc",
  from_key: "2026-07-01",
  to_key: "2026-10-01",
  effectiveDate: "2026-12-01",
  oldAmount: 500000,
  newAmount: 543500,
  currency: "ARS",
  variationPct: 8.7,
};

describe("frecuencia y fechas", () => {
  it("nombra las frecuencias habituales", () => {
    expect(frequencyLabel(3)).toBe("trimestral");
    expect(frequencyLabel(4)).toBe("cuatrimestral");
    expect(frequencyLabel(6)).toBe("semestral");
    expect(frequencyLabel(12)).toBe("anual");
    expect(frequencyLabel(5)).toBe("cada 5 meses");
    expect(frequencyLabel(null)).toBe("sin ajuste");
  });

  it("fecha larga en castellano", () => {
    expect(longDate("2026-12-01")).toBe("1 de diciembre de 2026");
    expect(longDate("no-es-fecha")).toBe("no-es-fecha");
  });
});

describe("meses del índice", () => {
  it("usa del mes siguiente al base hasta el de llegada", () => {
    expect(monthsUsed("2026-01-01", "2026-04-01")).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(monthsUsedShort("2026-01-01", "2026-04-01")).toBe("feb–abr");
    expect(monthsUsedLong("2026-01-01", "2026-04-01")).toBe("febrero a abril");
  });

  it("marca el año cuando cruza diciembre", () => {
    expect(monthsUsedShort("2025-10-01", "2026-01-01")).toBe("nov 25–ene 26");
    expect(monthsUsedLong("2025-10-01", "2026-01-01")).toBe("noviembre de 2025 a enero de 2026");
  });

  it("un solo mes o claves inválidas", () => {
    expect(monthsUsedShort("2026-03-01", "2026-04-01")).toBe("abr");
    expect(monthsUsed("2026-04-01", "2026-04-01")).toEqual([]);
    expect(monthsUsedShort("2026-05-01", "2026-04-01")).toBe("—");
  });
});

describe("variación y montos", () => {
  it("formatea en es-AR con signo", () => {
    expect(formatVariation(8.7)).toBe("+8,7 %");
    expect(formatVariation(8.746)).toBe("+8,75 %");
    expect(formatVariation(0.001)).toBe("0 %");
    expect(formatVariation(-1.25)).toBe("-1,25 %");
    expect(formatVariation(null)).toBe("—");
  });

  it("monto sin centavos cuando es entero", () => {
    expect(plainMoney(543500).replace(/\s/g, " ")).toBe("$ 543.500");
    expect(plainMoney(1234.5).replace(/\s/g, " ")).toBe("$ 1.234,50");
  });
});

describe("línea del método", () => {
  it("índice mensual con meses usados", () => {
    expect(adjustmentMethodLine(ipc, 3)).toBe("IPC · trimestral · meses: ago–oct");
  });

  it("índice diario con fechas", () => {
    const icl = { method: "indice" as const, index_code: "icl", from_key: "2025-06-01", to_key: "2026-06-01" };
    expect(adjustmentMethodLine(icl, 12)).toBe("ICL · anual · del 01/06/2025 al 01/06/2026");
  });

  it("otros métodos", () => {
    const base = { index_code: null, from_key: null, to_key: null };
    expect(adjustmentMethodLine({ ...base, method: "porcentaje_fijo" }, 4, { fixedPct: 10 })).toBe("Porcentaje fijo +10 % · cuatrimestral");
    expect(adjustmentMethodLine({ ...base, method: "escalonado" }, 6)).toBe("Monto pactado · semestral");
    expect(adjustmentMethodLine({ ...base, method: "manual" }, 3)).toBe("Monto a mano · trimestral");
    expect(adjustmentMethodLine({ ...base, method: "sin_ajuste" }, null)).toBe("Sin ajuste");
  });
});

describe("aviso al inquilino", () => {
  it("explica el índice y los meses", () => {
    expect(adjustmentBasisText(ipc)).toBe("según IPC de agosto a octubre");
    expect(adjustmentSentence(ipc).replace(/\s/g, " ")).toBe(
      "Desde el 1 de diciembre de 2026 el alquiler pasa de $ 500.000 a $ 543.500 (+8,7 % según IPC de agosto a octubre).",
    );
  });

  it("un monto corregido a mano no cita el índice", () => {
    expect(adjustmentBasisText({ ...ipc, overridden: true })).toBe("según lo acordado");
  });

  it("porcentaje fijo sin signo en el texto", () => {
    expect(adjustmentBasisText({ ...ipc, method: "porcentaje_fijo", fixedPct: 10 })).toBe("por el aumento pactado del 10 %");
  });

  it("WhatsApp: saludo con el primer nombre y sin emojis", () => {
    const text = adjustmentWhatsappText({ ...ipc, tenantName: "maría josé Pérez", orgName: "Inmobiliaria Sur", address: "Dean Funes 450 · 3°B" });
    expect(text.startsWith("Hola María, ¿cómo estás? Te escribimos de Inmobiliaria Sur por el alquiler de Dean Funes 450 · 3°B.")).toBe(true);
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
    expect(firstNameOf("")).toBe("");
  });

  it("cuándo sale el índice que falta", () => {
    expect(waitingForIndexText("ipc", "2026-09-01")).toBe("Esperando el IPC de septiembre (el INDEC lo publica a mediados de octubre).");
    expect(waitingForIndexText("icl", "2026-12-01")).toContain("ICL del 01/12/2026");
    expect(waitingForIndexText(null, null)).toBe("Esperando que se publique el índice.");
  });

  it("Casa Propia nombra el mes que de verdad falta, no un mes que ya está cargado", () => {
    // Cargado nov-25 … abr-26 salvo enero (un hueco).
    const coverage = { first: "2025-11-01", last: "2026-04-01", gaps: ["2026-01-01"] };
    // Sin lo cargado, como antes: el final de la ventana (ahora con año).
    expect(waitingForIndexText("casa_propia", "2026-04-01")).toBe("Esperando el coeficiente Casa Propia de abril de 2026 (se carga a mano cuando sale).");
    // Abril está: lo que falta es el hueco de enero.
    expect(waitingForIndexText("casa_propia", "2026-04-01", { coverage, fromKey: "2025-10-01" })).toBe(
      "Esperando el coeficiente Casa Propia de enero de 2026 (se carga a mano cuando sale).",
    );
    // Todavía no salió junio.
    expect(waitingForIndexText("casa_propia", "2026-06-01", { coverage, fromKey: "2026-02-01" })).toContain("de junio de 2026");
    // A la ventana feb → abr no le falta nada.
    expect(waitingForIndexText("casa_propia", "2026-04-01", { coverage, fromKey: "2026-02-01" })).toBe(
      "Ya están cargados los coeficientes Casa Propia que usa este ajuste.",
    );
    // Sin nada cargado falta el final de la ventana.
    expect(waitingForIndexText("casa_propia", "2026-04-01", { coverage: null })).toContain("de abril de 2026");
  });
});
