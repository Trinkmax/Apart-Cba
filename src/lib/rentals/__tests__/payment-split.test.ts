import { describe, expect, it } from "vitest";
import { agencyPartLabel, primaryOwnerIndex, splitDirectPayment, type SplitLine, type SplitOwner } from "../payment-split";

const solo: SplitOwner[] = [{ ownerId: "o1", name: "Ulises Rojas", pct: 100, isPrimary: true }];
const rent = (amount: number): SplitLine => ({ kind: "alquiler", payee: "propietario", amount });

describe("splitDirectPayment", () => {
  it("8 % de administración: el 92 % va al propietario y el 8 % a la inmobiliaria", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    expect(s.agency).toMatchObject({ total: 8_000, fee: 8_000, vat: 0, feeBase: 100_000, feePct: 8 });
    expect(s.owner.total).toBe(92_000);
    expect(s.owner.shares).toEqual([{ ownerId: "o1", name: "Ulises Rojas", pct: 100, amount: 92_000 }]);
    expect(s.remainder).toBe(0);
  });

  it("con IVA: los honorarios llevan 21 % encima y salen de la parte del propietario", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: true }, owners: solo });
    expect(s.agency).toMatchObject({ fee: 8_000, vat: 1_680, total: 9_680 });
    expect(s.owner.total).toBe(90_320);
  });

  it("la diferencia por ajuste paga honorarios; los punitorios del propietario no", () => {
    const s = splitDirectPayment({
      total: 115_000,
      lines: [rent(100_000), { kind: "diferencia_ajuste", payee: "propietario", amount: 10_000 }, { kind: "punitorio", payee: "propietario", amount: 5_000 }],
      rule: { adminFeePct: 8, adminFeeVat: false },
      owners: solo,
    });
    expect(s.agency.feeBase).toBe(110_000);
    expect(s.agency.fee).toBe(8_800);
    expect(s.owner.total).toBe(106_200);
  });

  it("lo que ya era de la inmobiliaria y los pasamanos van enteros a su cuenta", () => {
    const s = splitDirectPayment({
      total: 160_000,
      lines: [
        rent(100_000),
        { kind: "punitorio", payee: "inmobiliaria", amount: 3_000 },
        { kind: "honorarios", payee: "inmobiliaria", amount: 40_000 },
        { kind: "expensas", payee: "consorcio", amount: 17_000 },
      ],
      rule: { adminFeePct: 8, adminFeeVat: false },
      owners: solo,
    });
    expect(s.agency).toMatchObject({ fee: 8_000, own: 43_000, passThrough: 17_000, total: 68_000 });
    expect(s.owner.total).toBe(92_000);
    expect(agencyPartLabel(s)).toBe("honorarios 8 %, conceptos de la inmobiliaria y pagos a terceros (consorcio, servicios)");
  });

  it("lo que sobra queda como saldo a favor en la parte del propietario (sin honorarios encima)", () => {
    const s = splitDirectPayment({ total: 120_000, lines: [rent(100_000)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    expect(s.remainder).toBe(20_000);
    expect(s.agency.total).toBe(8_000);
    expect(s.owner.total).toBe(112_000);
  });

  it("sin honorarios pactados todo es del propietario", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 0, adminFeeVat: true }, owners: solo });
    expect(s.agency.total).toBe(0);
    expect(s.agency.vat).toBe(0);
    expect(s.owner.total).toBe(100_000);
    expect(agencyPartLabel(s)).toBe("nada");
  });

  it("redondea los honorarios al centavo", () => {
    const s = splitDirectPayment({ total: 123_456.78, lines: [rent(123_456.78)], rule: { adminFeePct: 8, adminFeeVat: false }, owners: solo });
    expect(s.agency.fee).toBe(9_876.54);
    expect(s.owner.total).toBe(113_580.24);
  });

  it("co-propietarios: cada uno su % truncado al centavo y el principal se lleva lo que sobra", () => {
    const owners: SplitOwner[] = [
      { ownerId: "a", name: "Ana", pct: 33.33, isPrimary: false },
      { ownerId: "b", name: "Beto", pct: 33.33, isPrimary: true },
      { ownerId: "c", name: "Ceci", pct: 33.34, isPrimary: false },
    ];
    const s = splitDirectPayment({ total: 100_000.01, lines: [rent(100_000.01)], rule: { adminFeePct: 8, adminFeeVat: false }, owners });
    const byId = Object.fromEntries(s.owner.shares.map((x) => [x.ownerId, x.amount]));
    // 92.000,01 para los titulares: 33,33 % → 30.663,603 → 30.663,60; 33,34 % → 30.672,803 → 30.672,80.
    expect(s.owner.total).toBe(92_000.01);
    expect(byId.a).toBe(30_663.6);
    expect(byId.c).toBe(30_672.8);
    expect(byId.b).toBe(30_663.61);
    expect(Math.round((byId.a + byId.b + byId.c) * 100) / 100).toBe(s.owner.total);
    expect(Math.round((s.owner.total + s.agency.total) * 100) / 100).toBe(100_000.01);
  });

  it("sin titular marcado, el principal es el de mayor %", () => {
    expect(primaryOwnerIndex([
      { ownerId: "a", name: "A", pct: 40, isPrimary: false },
      { ownerId: "b", name: "B", pct: 60, isPrimary: false },
    ])).toBe(1);
    expect(primaryOwnerIndex([])).toBe(-1);
  });

  it("sin propietarios cargados igual calcula el reparto (las partes quedan vacías)", () => {
    const s = splitDirectPayment({ total: 50_000, lines: [rent(50_000)], rule: { adminFeePct: 10, adminFeeVat: false }, owners: [] });
    expect(s.owner.total).toBe(45_000);
    expect(s.owner.shares).toEqual([]);
  });

  it("unos honorarios absurdos nunca dejan negativa la parte del propietario", () => {
    const s = splitDirectPayment({ total: 100_000, lines: [rent(100_000)], rule: { adminFeePct: 90, adminFeeVat: true }, owners: solo });
    expect(s.owner.total).toBe(0);
    expect(s.agency.fee).toBe(90_000);
    expect(s.agency.vat).toBe(10_000);
    expect(s.agency.total).toBe(100_000);
  });

  it("las partes siempre suman exacto lo pagado", () => {
    const owners: SplitOwner[] = [
      { ownerId: "a", name: "A", pct: 70, isPrimary: true },
      { ownerId: "b", name: "B", pct: 30, isPrimary: false },
    ];
    for (let i = 1; i <= 300; i++) {
      const r = Math.round(((i * 7919.37) % 250_000) * 100) / 100;
      const extra = Math.round(((i * 131.11) % 9_000) * 100) / 100;
      const total = Math.round((r + extra + (i % 3) * 1000) * 100) / 100;
      const s = splitDirectPayment({
        total,
        lines: [rent(r), { kind: "punitorio", payee: i % 2 ? "propietario" : "inmobiliaria", amount: extra }],
        rule: { adminFeePct: (i % 12) + 0.5, adminFeeVat: i % 4 === 0 },
        owners,
      });
      expect(Math.round((s.owner.total + s.agency.total) * 100) / 100).toBe(s.total);
      expect(Math.round(s.owner.shares.reduce((x, y) => x + y.amount, 0) * 100) / 100).toBe(s.owner.total);
      expect(s.owner.total).toBeGreaterThanOrEqual(0);
    }
  });
});
