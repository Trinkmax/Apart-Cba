import { describe, expect, it } from "vitest";
import {
  buildReceiptWhatsappText,
  buildReminderWhatsappText,
  firstNameOf,
  plainMoney,
  reminderTotal,
} from "@/components/rentals/collections/messages";

describe("firstNameOf", () => {
  it("toma el primer nombre de una persona", () => {
    expect(firstNameOf("Juan Carlos Pérez")).toBe("Juan");
    expect(firstNameOf("  lucía   gómez ")).toBe("lucía");
  });
  it("entiende el formato 'Apellido, Nombre'", () => {
    expect(firstNameOf("Pérez, Juan Carlos")).toBe("Juan");
  });
  it("una empresa queda con el nombre completo y vacío no rompe", () => {
    expect(firstNameOf("Distribuidora Sur SRL", true)).toBe("Distribuidora Sur SRL");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("plainMoney", () => {
  it("no deja espacios duros (NBSP) que WhatsApp muestra raro", () => {
    expect(plainMoney(543500, "ARS")).not.toMatch(/ /);
    expect(plainMoney(543500, "ARS")).toContain("543.500,00");
  });
});

describe("buildReceiptWhatsappText", () => {
  const base = {
    tenantName: "Juan Pérez",
    orgName: "Inmobiliaria Centro",
    address: "Dean Funes 450 · 3°B",
    amount: 543500,
    currency: "ARS",
    receiptNumber: "000123",
    pendingTotal: 0,
    creditLeft: 0,
  };

  it("confirma el pago con el número de recibo y dice que quedó al día", () => {
    const t = buildReceiptWhatsappText(base);
    expect(t).toContain("Hola Juan!");
    expect(t).toContain("Recibo N° 000123");
    expect(t).toContain("quedás al día");
    expect(t).not.toContain("pendiente");
  });

  it("deja constancia de lo que sigue debiendo y del saldo a favor", () => {
    const t = buildReceiptWhatsappText({ ...base, pendingTotal: 12500, creditLeft: 0 });
    expect(t).toContain("Queda pendiente");
    expect(t).toContain("12.500,00");
    const c = buildReceiptWhatsappText({ ...base, creditLeft: 1000 });
    expect(c).toContain("saldo a favor");
  });

  it("un recibo anulado avisa la anulación y no confirma ningún pago", () => {
    const t = buildReceiptWhatsappText({ ...base, voided: true, pendingTotal: 5000 });
    expect(t).toContain("quedó anulado");
    expect(t).not.toContain("Te confirmamos");
    expect(t).not.toContain("Queda pendiente");
  });

  it("incluye el link del inquilino cuando lo hay", () => {
    const t = buildReceiptWhatsappText({ ...base, portalUrl: "https://x.com/inquilino/abc" });
    expect(t).toContain("https://x.com/inquilino/abc");
  });
});

describe("buildReminderWhatsappText", () => {
  const base = {
    tenantName: "Lucía Gómez",
    orgName: "Inmobiliaria Centro",
    address: "Chacabuco 120",
    currency: "ARS",
    today: "2026-10-15",
    hasLateFees: true,
  };

  it("separa lo vencido de lo que vence y suma el total", () => {
    const t = buildReminderWhatsappText({
      ...base,
      lines: [
        { label: "Octubre 2026 · Período 2/3", dueDate: "2026-10-10", outstanding: 500000 },
        { label: "Expensas", dueDate: "2026-10-20", outstanding: 80000 },
      ],
    });
    expect(t).toContain("Te pasamos lo que tenés pendiente");
    expect(t).toContain("venció el 10/10");
    expect(t).toContain("vence el 20/10");
    expect(t).toContain("Total:");
    expect(t).toContain("580.000,00");
    expect(t).toContain("intereses por mora");
  });

  it("sin deuda no inventa un aviso de cobro", () => {
    const t = buildReminderWhatsappText({ ...base, lines: [] });
    expect(t).toContain("no tenés nada pendiente");
    expect(t).not.toContain("Para pagar");
  });

  it("agrega los datos para transferir y el link para subir el comprobante", () => {
    const t = buildReminderWhatsappText({
      ...base,
      hasLateFees: false,
      lines: [{ label: "Noviembre 2026", dueDate: "2026-11-10", outstanding: 300000 }],
      paymentInstructions: "Alias: centro.alquileres",
      portalUrl: "https://x.com/inquilino/abc",
    });
    expect(t).toContain("Te recordamos lo que vence");
    expect(t).toContain("Alias: centro.alquileres");
    expect(t).toContain("https://x.com/inquilino/abc");
    expect(t).not.toContain("Total:");
    expect(t).not.toContain("mora");
  });

  it("reminderTotal redondea a centavos", () => {
    expect(reminderTotal([{ label: "a", dueDate: "2026-01-01", outstanding: 0.1 }, { label: "b", dueDate: "2026-01-01", outstanding: 0.2 }])).toBe(0.3);
  });
});
