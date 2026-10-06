import { describe, expect, it } from "vitest";
import { buildRentalReceiptDoc, type RentalReceiptData } from "@/lib/pdf/rental-receipt-pdf";

function data(over: Partial<RentalReceiptData> = {}): RentalReceiptData {
  return {
    org: {
      name: "Inmobiliaria Centro",
      legal_name: "Centro Propiedades SRL",
      tax_id: null,
      logo_url: null,
      primary_color: "#0F766E",
      address: null,
      contact_phone: null,
      contact_email: null,
    },
    broker: { name: null, license: null },
    receipt: {
      id: "p1",
      number: 123,
      paidAt: "2026-10-12",
      amount: 100000,
      currency: "ARS",
      methodLabel: "Transferencia",
      reference: null,
      accountName: null,
      collectedByOwner: true,
      payerName: null,
      voided: false,
      voidedAt: null,
      voidReason: null,
      issuedBy: null,
    },
    contract: { id: "c1", number: 7, address: "Dean Funes 450", city: "Córdoba" },
    tenant: { name: "Juan Pérez", docType: "DNI", docNumber: "30123456", taxId: null, email: null, phone: null, isCompany: false },
    lines: [{ chargeLabel: "Octubre 2026", description: "Alquiler Octubre 2026", amount: 100000 }],
    creditLeft: 0,
    pending: { asOf: "2026-10-12", total: 0, items: [] },
    footer: null,
    ...over,
  };
}

async function rawOf(d: RentalReceiptData): Promise<string> {
  const doc = await buildRentalReceiptDoc(d, { logo: null });
  return doc.output();
}

describe("recibo con reparto (cobra el propietario)", () => {
  it("dice cómo se pagó: la parte del propietario y la de la inmobiliaria", async () => {
    const raw = await rawOf(
      data({
        split: {
          ownerTotal: 92000,
          agencyTotal: 8000,
          agencyAccountName: "Banco Galicia",
          agencyLabel: "honorarios 8 %",
          owners: [{ name: "Ulises Rojas", amount: 92000 }],
        },
      }),
    );
    expect(raw).toContain("MO SE PAG");
    expect(raw).toContain("Al propietario · Ulises Rojas");
    expect(raw).toContain("A Inmobiliaria Centro · honorarios 8 % · Banco Galicia");
    // El bloque reemplaza la frase vieja ("lo cobró el propietario"), que ya no es toda la verdad.
    expect(raw).not.toContain("Lo cobró directamente el propietario");
  });

  it("con varios titulares, una fila por cada uno; sin parte de la inmobiliaria no la muestra", async () => {
    const raw = await rawOf(
      data({
        split: {
          ownerTotal: 100000,
          agencyTotal: 0,
          agencyAccountName: null,
          agencyLabel: "sin honorarios",
          owners: [
            { name: "Ulises Rojas", amount: 60000 },
            { name: "Marta Paz", amount: 40000 },
          ],
        },
      }),
    );
    expect(raw).toContain("Al propietario · Ulises Rojas");
    expect(raw).toContain("Al propietario · Marta Paz");
    expect(raw).not.toContain("A Inmobiliaria Centro");
  });

  it("sin reparto el recibo queda como antes", async () => {
    const raw = await rawOf(data());
    expect(raw).not.toContain("MO SE PAG");
    expect(raw).toContain("Lo cobró directamente el propietario");
  });
  it("si el inquilino le pagó todo a la inmobiliaria, el recibo lo dice en una sola fila", async () => {
    const raw = await rawOf(
      data({
        split: {
          ownerTotal: 92000,
          agencyTotal: 8000,
          agencyAccountName: "Banco Galicia",
          agencyLabel: "honorarios 8 %",
          owners: [{ name: "Ulises Rojas", amount: 92000 }],
          route: "todo_inmobiliaria",
        },
      }),
    );
    expect(raw).toContain("Todo a Inmobiliaria Centro · Banco Galicia");
    expect(raw).not.toContain("Al propietario · Ulises Rojas");
  });
});
