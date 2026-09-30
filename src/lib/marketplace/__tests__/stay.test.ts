import { describe, expect, it } from "vitest";
import {
  headlinePrice,
  isMonthlyStay,
  MONTHLY_STAY_MIN_NIGHTS,
  offersMonthlyStays,
  offersShortStays,
  quoteStay,
} from "@/lib/marketplace/stay";

describe("isMonthlyStay", () => {
  it("desde 28 noches es por mes", () => {
    expect(MONTHLY_STAY_MIN_NIGHTS).toBe(28);
    expect(isMonthlyStay(27)).toBe(false);
    expect(isMonthlyStay(28)).toBe(true);
    expect(isMonthlyStay(Number.NaN)).toBe(false);
  });
});

describe("pestañas: por noche vs por mes", () => {
  it("una temporaria con mínimo de 30 noches es mensual en los hechos", () => {
    const u = { default_mode: "temporario", min_nights: 30 };
    expect(offersShortStays(u)).toBe(false);
    expect(offersMonthlyStays(u)).toBe(true);
  });
  it("temporaria corta: sólo por noche", () => {
    const u = { default_mode: "temporario", min_nights: 2 };
    expect(offersShortStays(u)).toBe(true);
    expect(offersMonthlyStays(u)).toBe(false);
  });
  it("mixta con mínimo corto: las dos", () => {
    const u = { default_mode: "mixto", min_nights: 2 };
    expect(offersShortStays(u)).toBe(true);
    expect(offersMonthlyStays(u)).toBe(true);
  });
  it("mensual: sólo por mes, aunque el mínimo sea corto", () => {
    const u = { default_mode: "mensual", min_nights: 2 };
    expect(offersShortStays(u)).toBe(false);
    expect(offersMonthlyStays(u)).toBe(true);
  });
});

describe("quoteStay", () => {
  const base = { basePrice: 70_000, cleaningFee: null, pricingRules: [] };

  it("menos de 28 noches: por noche", () => {
    const q = quoteStay({ ...base, monthlyPrice: 900_000, checkInIso: "2026-10-01", checkOutIso: "2026-10-04" });
    expect(q.kind).toBe("nightly");
    if (q.kind === "nightly") {
      expect(q.nights).toBe(3);
      expect(q.total).toBe(210_000);
      expect(q.avgNightly).toBe(70_000);
    }
  });

  it("28+ noches con precio mensual: mes ÷ 30 × noches (nunca noche × 30)", () => {
    const q = quoteStay({ ...base, monthlyPrice: 900_000, checkInIso: "2026-10-01", checkOutIso: "2026-10-31" });
    expect(q).toEqual({ kind: "monthly", nights: 30, monthlyPrice: 900_000, estimatedTotal: 900_000 });
    const q2 = quoteStay({ ...base, monthlyPrice: 900_000, checkInIso: "2026-10-01", checkOutIso: "2026-11-15" });
    if (q2.kind === "monthly") expect(q2.estimatedTotal).toBe(1_350_000);
  });

  it("28+ noches sin precio mensual: a consultar", () => {
    const q = quoteStay({ ...base, monthlyPrice: null, checkInIso: "2026-10-01", checkOutIso: "2026-11-01" });
    expect(q).toEqual({ kind: "monthly", nights: 31, monthlyPrice: null, estimatedTotal: null });
  });
});

describe("headlinePrice", () => {
  it("por noche muestra la noche; sin estadías cortas cae al mes o a consultar", () => {
    expect(headlinePrice({ default_mode: "mixto", min_nights: 2, base_price: 80_000, monthly_price: 1_050_000 }, "noche"))
      .toEqual({ kind: "amount", amount: 80_000, per: "noche" });
    expect(headlinePrice({ default_mode: "temporario", min_nights: 30, base_price: 65_000, monthly_price: null }, "noche"))
      .toEqual({ kind: "consult" });
  });
  it("por mes: el mensual de lista o consultar (nunca noche × 30)", () => {
    expect(headlinePrice({ default_mode: "mensual", min_nights: 30, base_price: 90_000, monthly_price: null }, "mes"))
      .toEqual({ kind: "consult" });
    expect(headlinePrice({ default_mode: "mensual", min_nights: 2, base_price: 80_000, monthly_price: 1_020_000 }, "mes"))
      .toEqual({ kind: "amount", amount: 1_020_000, per: "mes" });
  });
});
