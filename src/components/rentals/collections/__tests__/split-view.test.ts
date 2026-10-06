import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import { splitDirectPayment, type SplitLine, type SplitOwner } from "@/lib/rentals/payment-split";
import type { PaymentOwner } from "@/lib/rentals/server/collections-queries";
import {
  agencyBreakdown,
  agencyNameOf,
  capitalizeFirst,
  joinNames,
  needsAgencyAccount,
  pctLabel,
  showsRemainderWarning,
  splitOwnerRows,
  splitSummaryText,
  toLedgerSplit,
} from "@/components/rentals/collections/split-view";

const rent = (amount: number): SplitLine => ({ kind: "alquiler", payee: "propietario", amount });
const solo: SplitOwner[] = [{ ownerId: "o1", name: "Ulises Rojas", pct: 100, isPrimary: true }];
const pair: SplitOwner[] = [
  { ownerId: "o1", name: "Ulises Rojas", pct: 50, isPrimary: true },
  { ownerId: "o2", name: "Ana Gómez", pct: 50, isPrimary: false },
];
const bankOf = (o: SplitOwner, extra: Partial<PaymentOwner> = {}): PaymentOwner => ({
  ...o,
  bankName: null,
  cbu: null,
  alias: null,
  ...extra,
});
const $ = (n: number) => formatMoney(n, "ARS");

describe("nombre de la inmobiliaria", () => {
  it("usa el de la organización y, sin dato, uno genérico", () => {
    expect(agencyNameOf("Apart CBA")).toBe("Apart CBA");
    expect(agencyNameOf("  ")).toBe("la inmobiliaria");
    expect(agencyNameOf(null)).toBe("la inmobiliaria");
    expect(capitalizeFirst("la inmobiliaria")).toBe("La inmobiliaria");
    expect(capitalizeFirst("")).toBe("");
  });
});

describe("cuenta de la inmobiliaria", () => {
  it("se pide sólo si su parte es mayor a cero", () => {
    const fee = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    const none = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 0, adminFeeVat: false }, owners: solo });
    expect(needsAgencyAccount(fee)).toBe(true);
    expect(needsAgencyAccount(none)).toBe(false);
    expect(needsAgencyAccount(null)).toBe(false);
  });
});

describe("aviso de plata que sobra", () => {
  it("aparece si sobra y el contrato cobra honorarios", () => {
    const over = splitDirectPayment({ total: 120_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    const exact = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    const noFee = splitDirectPayment({ total: 120_000, lines: [rent(100_000)], rule: { adminFeePct: 0, adminFeeVat: false }, owners: solo });
    expect(showsRemainderWarning(over)).toBe(true);
    expect(showsRemainderWarning(exact)).toBe(false);
    expect(showsRemainderWarning(noFee)).toBe(false);
  });
});

describe("filas de los titulares", () => {
  it("cruza cada parte con sus datos bancarios y marca a quien no tiene CBU ni alias", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: pair });
    const rows = splitOwnerRows(s, [bankOf(pair[0], { cbu: " 0070000000000000000001 ", bankName: "Galicia" }), bankOf(pair[1], { alias: "" })]);
    expect(rows.map((r) => [r.name, r.pct, r.amount])).toEqual([
      ["Ulises Rojas", 50, 46_000],
      ["Ana Gómez", 50, 46_000],
    ]);
    expect(rows[0].bank).toEqual({ bankName: "Galicia", cbu: "0070000000000000000001", alias: null });
    expect(rows[0].missingBank).toBe(false);
    expect(rows[1].missingBank).toBe(true);
  });

  it("sin los datos del titular no avisa que faltan (no lo sabemos)", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    const [row] = splitOwnerRows(s, []);
    expect(row.bank).toBeNull();
    expect(row.missingBank).toBe(false);
  });
});

describe("textos", () => {
  it("une nombres y porcentajes en es-AR", () => {
    expect(joinNames(["Ulises"])).toBe("Ulises");
    expect(joinNames(["Ulises", "Ana"])).toBe("Ulises y Ana");
    expect(joinNames(["Ulises", " ", "Ana", "Luis"])).toBe("Ulises, Ana y Luis");
    expect(joinNames([])).toBe("");
    expect(pctLabel(50)).toBe("50 %");
    expect(pctLabel(33.333)).toBe("33,33 %");
  });

  it("desglosa la parte de la inmobiliaria sin renglones en cero", () => {
    const s = splitDirectPayment({
      total: 126_680,
      lines: [rent(100_000), { kind: "expensas", payee: "consorcio", amount: 17_000 }],
      rule: { adminFeePct: 8, adminFeeVat: true },
      owners: solo,
    });
    expect(agencyBreakdown(s, "ARS")).toEqual([
      { label: `Honorarios 8 % sobre ${$(100_000)} de alquiler`, amount: 8_000 },
      { label: "IVA de los honorarios (21 %)", amount: 1_680 },
      { label: "Para pagarle a terceros (consorcio, servicios)", amount: 17_000 },
    ]);
  });
});

describe("resumen del reparto (éxito y cuenta corriente)", () => {
  it("arma la línea con la cuenta y el concepto", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    const ledger = toLedgerSplit(s, "Banco Galicia");
    expect(ledger).toEqual({
      ownerTotal: 92_000,
      agencyTotal: 8_000,
      agencyAccountName: "Banco Galicia",
      agencyLabel: "honorarios 8 %",
      owners: [{ name: "Ulises Rojas", amount: 92_000 }],
    });
    expect(splitSummaryText(ledger, "ARS")).toBe(`Directo al propietario ${$(92_000)} · A Banco Galicia ${$(8_000)} (honorarios 8 %)`);
  });

  it("todo del propietario: sin cuenta ni concepto", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 0, adminFeeVat: false }, owners: pair });
    const ledger = toLedgerSplit(s, "Banco Galicia");
    expect(ledger.agencyAccountName).toBeNull();
    expect(ledger.agencyLabel).toBe("");
    expect(splitSummaryText(ledger, "ARS")).toBe(`Directo a los propietarios ${$(100_000)}`);
  });

  it("sólo la parte de la inmobiliaria, y sin nombre de cuenta cae en «Caja»", () => {
    const text = splitSummaryText({ ownerTotal: 0, agencyTotal: 40_000, agencyAccountName: null, agencyLabel: "nada", owners: [] }, "ARS");
    expect(text).toBe(`A Caja ${$(40_000)}`);
  });
});
