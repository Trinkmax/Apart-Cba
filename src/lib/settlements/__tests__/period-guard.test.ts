import { describe, expect, it } from "vitest";
import {
  defaultSettlementPeriod,
  isPeriodUnfinished,
  lastClosedPeriod,
} from "../period-guard";

describe("defaultSettlementPeriod", () => {
  it("a principios de mes abre en el que cerró (el error del 03/11)", () => {
    expect(defaultSettlementPeriod("2026-11-03")).toEqual({ year: 2026, month: 10 });
  });

  it("el error del 14/09 tampoco se repite", () => {
    expect(defaultSettlementPeriod("2026-09-14")).toEqual({ year: 2026, month: 8 });
  });

  it("cambia después del 15", () => {
    expect(defaultSettlementPeriod("2026-11-15")).toEqual({ year: 2026, month: 10 });
    expect(defaultSettlementPeriod("2026-11-16")).toEqual({ year: 2026, month: 11 });
  });

  it("en enero vuelve a diciembre del año anterior", () => {
    expect(defaultSettlementPeriod("2027-01-05")).toEqual({ year: 2026, month: 12 });
    expect(defaultSettlementPeriod("2027-01-20")).toEqual({ year: 2027, month: 1 });
  });
});

describe("lastClosedPeriod", () => {
  it("es el mes anterior a hoy, sea el día que sea", () => {
    expect(lastClosedPeriod("2026-11-03")).toEqual({ year: 2026, month: 10 });
    expect(lastClosedPeriod("2026-11-29")).toEqual({ year: 2026, month: 10 });
    expect(lastClosedPeriod("2027-01-01")).toEqual({ year: 2026, month: 12 });
  });
});

describe("isPeriodUnfinished", () => {
  const today = "2026-11-03";

  it("el mes de hoy y los futuros no terminaron", () => {
    expect(isPeriodUnfinished({ year: 2026, month: 11 }, today)).toBe(true);
    expect(isPeriodUnfinished({ year: 2026, month: 12 }, today)).toBe(true);
    expect(isPeriodUnfinished({ year: 2027, month: 1 }, today)).toBe(true);
  });

  it("los anteriores sí, también los de otro año con mes mayor", () => {
    expect(isPeriodUnfinished({ year: 2026, month: 10 }, today)).toBe(false);
    expect(isPeriodUnfinished({ year: 2025, month: 12 }, today)).toBe(false);
  });
});
