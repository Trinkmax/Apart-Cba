import { describe, expect, it } from "vitest";
import { buildRentalReceiptDoc, receiptFilename, type RentalReceiptData } from "@/lib/pdf/rental-receipt-pdf";

function data(over: Partial<RentalReceiptData> = {}): RentalReceiptData {
  return {
    org: {
      name: "Inmobiliaria Centro",
      legal_name: "Centro Propiedades SRL",
      tax_id: "30-71234567-8",
      logo_url: null,
      primary_color: "#0F766E",
      address: "Av. Colón 1234, Córdoba",
      contact_phone: "351 555-1234",
      contact_email: "hola@centro.com",
    },
    broker: { name: "Lucía Gómez", license: "1234" },
    receipt: {
      id: "p1",
      number: 123,
      paidAt: "2026-10-12",
      amount: 543500,
      currency: "ARS",
      methodLabel: "Transferencia",
      reference: "0001",
      accountName: "Banco ARS",
      collectedByOwner: false,
      payerName: null,
      voided: false,
      voidedAt: null,
      voidReason: null,
      issuedBy: "Ana",
    },
    contract: { id: "c1", number: 7, address: "Dean Funes 450 · 3°B", city: "Córdoba" },
    tenant: { name: "Juan Pérez", docType: "DNI", docNumber: "30123456", taxId: null, email: null, phone: null, isCompany: false },
    lines: [{ chargeLabel: "Octubre 2026 · Período 2/3", description: "Alquiler Octubre 2026 · Período 2/3", amount: 543500 }],
    creditLeft: 0,
    pending: { asOf: "2026-10-12", total: 80000, items: [{ label: "Expensas", dueDate: "2026-10-20", outstanding: 80000 }] },
    footer: "Atención: lunes a viernes de 9 a 17.",
    ...over,
  };
}

/** El PDF de jsPDF sin comprimir deja el texto legible en el stream. */
async function textOf(d: RentalReceiptData): Promise<{ raw: string; pages: number }> {
  const doc = await buildRentalReceiptDoc(d, { logo: null });
  return { raw: doc.output(), pages: doc.getNumberOfPages() };
}

describe("recibo de alquiler (PDF)", () => {
  it("dice el importe en letras, la constancia de deuda (art. 899) y la leyenda de reserva", async () => {
    const { raw, pages } = await textOf(data());
    expect(pages).toBe(1);
    expect(raw).toContain("R E C I B O");
    expect(raw).toContain("Son pesos quinientos cuarenta y tres mil quinientos con 00/100.");
    expect(raw).toContain("CONSTANCIA DE DEUDA PENDIENTE");
    expect(raw).toContain("Queda pendiente");
    expect(raw).toContain("no implica conformidad con pagos parciales");
    expect(raw).not.toContain("ANULADO");
  });

  it("sin deuda lo dice explícitamente y un recibo anulado lleva la marca", async () => {
    const clean = await textOf(data({ pending: { asOf: "2026-10-12", total: 0, items: [] } }));
    expect(clean.raw).toContain("no registra deuda pendiente");
    const voided = await textOf(data({ receipt: { ...data().receipt, voided: true, voidedAt: "2026-10-13", voidReason: "transferencia rechazada" } }));
    expect(voided.raw).toContain("ANULADO");
  });

  it("muchos conceptos no rompen el documento (pasa a una segunda hoja)", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ chargeLabel: `Cargo ${i + 1}`, description: `Concepto ${i + 1}`, amount: 1000 }));
    const { pages } = await textOf(data({ lines, receipt: { ...data().receipt, amount: 40000 } }));
    expect(pages).toBeGreaterThan(1);
  });

  it("arma un nombre de archivo limpio", () => {
    expect(receiptFilename(data())).toBe("recibo-000123-juan-perez.pdf");
  });
});
