import { describe, expect, it } from "vitest";
import {
  monthBounds,
  monthOverlapNights,
  nightsBetween,
  periodFromIndex,
  periodIndex,
  periodOf,
} from "@/lib/finance/prorate";

describe("monthOverlapNights (P1)", () => {
  it("cuenta noches con fin exclusivo: un mes completo son todos sus días", () => {
    // El bug de settlements.ts (fin inclusivo) daba 30 y 29 en los dos primeros.
    expect(monthOverlapNights("2026-08-01", "2026-09-01", 2026, 8)).toBe(31);
    expect(monthOverlapNights("2026-09-01", "2026-10-01", 2026, 9)).toBe(30);
    expect(monthOverlapNights("2026-08-31", "2026-09-15", 2026, 8)).toBe(1);
    expect(monthOverlapNights("2026-08-15", "2026-09-01", 2026, 9)).toBe(0);
    // Check-in el último día del mes: 1 noche, no 0 (antes se salteaba).
    expect(monthOverlapNights("2026-07-31", "2026-08-01", 2026, 7)).toBe(1);
  });

  it("una estadía que cruza varios meses reparte todas sus noches (ALCORTA2, 11/09 → 08/11)", () => {
    // La liquidación generaba 19/30 en septiembre y 30/31 en octubre.
    expect(monthOverlapNights("2026-09-11", "2026-11-08", 2026, 9)).toBe(20);
    expect(monthOverlapNights("2026-09-11", "2026-11-08", 2026, 10)).toBe(31);
    expect(monthOverlapNights("2026-09-11", "2026-11-08", 2026, 11)).toBe(7);
    expect(20 + 31 + 7).toBe(nightsBetween("2026-09-11", "2026-11-08"));
  });
});

describe("helpers de período", () => {
  it("periodIndex / periodOf / periodFromIndex son consistentes", () => {
    expect(periodIndex(2026, 1)).toBe(2026 * 12);
    expect(periodOf("2026-09-15")).toEqual({ year: 2026, month: 9, index: periodIndex(2026, 9) });
    expect(periodFromIndex(periodIndex(2025, 12) + 1)).toEqual({ year: 2026, month: 1 });
  });

  it("monthBounds cruza el año sin Date local", () => {
    expect(monthBounds(2026, 12)).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01", days: 31 });
    expect(monthBounds(2028, 2).days).toBe(29);
  });

  it("nightsBetween nunca es negativo", () => {
    expect(nightsBetween("2026-07-30", "2026-07-02")).toBe(0);
    expect(nightsBetween("2026-03-28", "2026-03-30")).toBe(2); // cruza el cambio de hora de otros países
  });
});
