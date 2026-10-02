import { describe, expect, it } from "vitest";
import { commissionText, lateFeeText, paymentWindowText } from "../contract-terms";
import { buildIntimationLetter, lateFeeClause, longDateEs, type IntimationData } from "../intimation-text";

describe("contract-terms", () => {
  it("punitorios con su equivalente", () => {
    expect(lateFeeText("diario_pct", 0.5, "ARS")).toBe("0,5 % por día (≈ 15 % por mes)");
    expect(lateFeeText("ninguno", 0, "ARS")).toBe("Sin punitorios");
  });

  it("plazo para pagar según el día de inicio", () => {
    expect(paymentWindowText("2026-11-01", 10)).toBe("Del 1 al 10 de cada mes");
    expect(paymentWindowText("2026-11-15", 10)).toMatch(/el 15 de cada mes/);
  });

  it("honorarios en castellano", () => {
    expect(commissionText({ basis: "pct_total_contrato", value: 5, vat: true }, "ARS")).toBe("5 % del valor total del contrato + IVA");
    expect(commissionText({ basis: "meses", value: 1, vat: false }, "ARS")).toBe("1 mes de alquiler");
    expect(commissionText(null, "ARS")).toBe("Sin honorarios");
  });
});

describe("intimation-text", () => {
  it("fecha larga", () => {
    expect(longDateEs("2026-10-02")).toBe("2 de octubre de 2026");
  });

  const base: IntimationData = {
    today: "2026-10-02",
    city: "Córdoba",
    tenantName: "Juan Pérez",
    tenantDoc: null,
    propertyAddress: "Dean Funes 450, Córdoba",
    contractNumber: "C-0007",
    contractDate: "2026-03-01",
    currency: "ARS",
    lines: [{ label: "Septiembre 2026", dueDate: "2026-09-10", amount: 500_000 }],
    total: 500_000,
    totalWords: "pesos quinientos mil con 00/100",
    paymentPlace: "Colón 123",
    guarantors: [],
    signer: "Inmobiliaria Centro",
    lateFee: null,
  };

  it("sin punitorios pactados no los reclama: pide el interés moratorio legal", () => {
    const text = buildIntimationLetter(base);
    expect(text).not.toContain("punitorios");
    expect(text).toContain("intereses moratorios que correspondan (art. 768 CCyC) desde cada vencimiento");
  });

  it("con punitorios pactados cita la tasa exacta del contrato", () => {
    expect(buildIntimationLetter({ ...base, lateFee: { type: "diario_pct", value: 0.5 } })).toContain(
      "intereses punitorios pactados (0,5 % diario) desde cada vencimiento hasta el efectivo pago.",
    );
    expect(lateFeeClause({ type: "mensual_pct", value: 3 }, "ARS")).toContain("(3 % mensual)");
    expect(lateFeeClause({ type: "diario_pct", value: 0.033 }, "ARS")).toContain("(0,033 % diario)");
    expect(lateFeeClause({ type: "fijo_diario", value: 1500 }, "ARS")).toMatch(/pactados \(\$\s?1\.500(,00)? por cada día de atraso\)/);
  });

  it("arma la carta con la deuda, el plazo de 10 días y la copia a garantes", () => {
    const text = buildIntimationLetter({
      lateFee: { type: "diario_pct", value: 0.5 },
      today: "2026-10-02",
      city: "Córdoba",
      tenantName: "Juan Pérez",
      tenantDoc: "DNI 30123456",
      propertyAddress: "Dean Funes 450 · 3°B, Córdoba",
      contractNumber: "C-0007",
      contractDate: "2026-03-01",
      currency: "ARS",
      lines: [
        { label: "Septiembre 2026 · Período 1/3", dueDate: "2026-09-10", amount: 500_000 },
        { label: "Octubre 2026 · Período 2/3", dueDate: "2026-10-10", amount: 43_500 },
      ],
      total: 543_500,
      totalWords: "pesos quinientos cuarenta y tres mil quinientos con 00/100",
      paymentPlace: "Inmobiliaria Centro · Colón 123",
      guarantors: ["Ana Gómez"],
      signer: "Inmobiliaria Centro",
    });
    expect(text).toMatch(/^INTIMACIÓN DE PAGO/);
    expect(text).toContain("Córdoba, 2 de octubre de 2026.");
    expect(text).toContain("DIEZ (10) DÍAS CORRIDOS");
    expect(text).toContain("venció el 10/09/2026");
    expect(text).toContain("su garante: Ana Gómez");
    expect(text.trim().endsWith("Inmobiliaria Centro")).toBe(true);
  });
});
