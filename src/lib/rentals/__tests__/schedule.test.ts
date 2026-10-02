import { describe, expect, it } from "vitest";
import {
  adjustmentCount,
  buildAdjustmentWindows,
  buildSchedule,
  contractEndDate,
  periodAt,
  type ScheduleInput,
} from "@/lib/rentals/schedule";
import { addDays } from "@/lib/rentals/ymd";

const base: ScheduleInput = {
  startDate: "2026-03-01",
  durationMonths: 24,
  adjustmentEveryMonths: 3,
  paymentWindowDays: 10,
};

describe("contractEndDate", () => {
  it("es inicio + N meses − 1 día", () => {
    expect(contractEndDate("2026-01-01", 24)).toBe("2027-12-31");
    expect(contractEndDate("2026-03-15", 24)).toBe("2028-03-14");
    expect(contractEndDate("2026-01-31", 24)).toBe("2028-01-30");
  });

  it("un contrato del 01/03/2026 a 24 meses termina el 29/02/2028 (2028 es bisiesto)", () => {
    // El comentario de schedule.ts dice "28/02/2028", pero 2028 es bisiesto:
    // el período 24 es todo febrero de 2028 y termina el 29.
    expect(contractEndDate("2026-03-01", 24)).toBe("2028-02-29");
    expect(contractEndDate("2027-03-01", 24)).toBe("2029-02-28");
  });

  it("coincide con el fin del último período del cronograma", () => {
    for (const startDate of ["2026-01-01", "2026-01-31", "2026-03-15", "2027-12-31"]) {
      const s = buildSchedule({ ...base, startDate, durationMonths: 24 });
      expect(s[s.length - 1].end).toBe(contractEndDate(startDate, 24));
    }
  });
});

describe("buildSchedule — períodos", () => {
  it("un contrato de 24 meses tiene 24 períodos mensuales que arrancan el día del contrato", () => {
    const s = buildSchedule(base);
    expect(s).toHaveLength(24);
    expect(s[0]).toEqual({
      index: 1,
      start: "2026-03-01",
      end: "2026-03-31",
      dueDate: "2026-03-10",
      cycle: 1,
      indexInCycle: 1,
      cycleLength: 3,
      adjustsHere: false,
    });
    expect(s[1]).toMatchObject({ index: 2, start: "2026-04-01", end: "2026-04-30", dueDate: "2026-04-10" });
    expect(s[23]).toMatchObject({ index: 24, start: "2028-02-01", end: "2028-02-29", cycle: 8, indexInCycle: 3 });
  });

  it("los períodos son contiguos: cada uno empieza el día siguiente al fin del anterior", () => {
    for (const startDate of ["2026-03-01", "2026-03-15", "2026-01-31", "2026-08-30"]) {
      const s = buildSchedule({ ...base, startDate });
      for (let i = 1; i < s.length; i++) {
        expect(s[i].start).toBe(addDays(s[i - 1].end, 1));
      }
    }
  });

  it("un contrato que arranca a mitad de mes tiene períodos del 15 al 14", () => {
    const s = buildSchedule({ ...base, startDate: "2026-03-15" });
    expect(s[0]).toMatchObject({ start: "2026-03-15", end: "2026-04-14", dueDate: "2026-03-24" });
    expect(s[1]).toMatchObject({ start: "2026-04-15", end: "2026-05-14", dueDate: "2026-04-24" });
  });

  it("contrato del 31/01: los períodos se pegan a fin de mes y vuelven al 31 (31/01, 28/02, 31/03, 30/04…)", () => {
    const s = buildSchedule({ ...base, startDate: "2026-01-31", durationMonths: 6 });
    expect(s.map((p) => p.start)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(s.map((p) => p.end)).toEqual([
      "2026-02-27",
      "2026-03-30",
      "2026-04-29",
      "2026-05-30",
      "2026-06-29",
      "2026-07-30",
    ]);
  });

  it("en un año bisiesto el período de febrero arranca el 29", () => {
    const s = buildSchedule({ ...base, startDate: "2028-01-31", durationMonths: 3 });
    expect(s.map((p) => [p.start, p.end])).toEqual([
      ["2028-01-31", "2028-02-28"],
      ["2028-02-29", "2028-03-30"],
      ["2028-03-31", "2028-04-29"],
    ]);
    // Un contrato de 2027 cruza el febrero bisiesto en su período 14.
    const s2 = buildSchedule({ ...base, startDate: "2027-01-31", durationMonths: 24 });
    expect(s2[13].start).toBe("2028-02-29");
  });

  it("duración 0, negativa o fraccionaria: no inventa períodos", () => {
    expect(buildSchedule({ ...base, durationMonths: 0 })).toEqual([]);
    expect(buildSchedule({ ...base, durationMonths: -3 })).toEqual([]);
    expect(buildSchedule({ ...base, durationMonths: 2.9 })).toHaveLength(2);
  });
});

describe("buildSchedule — vencimiento", () => {
  it("vence dentro de los primeros N días del período (del 1 al 10)", () => {
    const s = buildSchedule(base);
    expect(s.every((p) => p.dueDate === addDays(p.start, 9))).toBe(true);
  });

  it("el vencimiento nunca cae después del fin del período", () => {
    const s = buildSchedule({ ...base, startDate: "2026-02-01", paymentWindowDays: 31, durationMonths: 3 });
    expect(s[0].dueDate).toBe("2026-02-28"); // 31 días no entran en febrero
    expect(s[1].dueDate).toBe("2026-03-31");
    const s40 = buildSchedule({ ...base, paymentWindowDays: 40 });
    expect(s40.every((p) => p.dueDate === p.end)).toBe(true);
  });

  it("plazo 0, negativo o vacío se trata como 1 día (vence el primer día del período)", () => {
    for (const paymentWindowDays of [0, -5, Number.NaN]) {
      const s = buildSchedule({ ...base, paymentWindowDays, durationMonths: 2 });
      expect(s.map((p) => p.dueDate)).toEqual(["2026-03-01", "2026-04-01"]);
    }
    const frac = buildSchedule({ ...base, paymentWindowDays: 10.9, durationMonths: 1 });
    expect(frac[0].dueDate).toBe("2026-03-10");
  });
});

describe("buildSchedule — ciclos de ajuste", () => {
  it("trimestral: ciclo 1 = períodos 1-3, ciclo 2 = 4-6…, el precio nuevo rige en el 1° de cada ciclo ≥ 2", () => {
    const s = buildSchedule(base);
    expect(s.slice(0, 7).map((p) => [p.cycle, p.indexInCycle, p.adjustsHere])).toEqual([
      [1, 1, false],
      [1, 2, false],
      [1, 3, false],
      [2, 1, true],
      [2, 2, false],
      [2, 3, false],
      [3, 1, true],
    ]);
    expect(s.filter((p) => p.adjustsHere).map((p) => p.index)).toEqual([4, 7, 10, 13, 16, 19, 22]);
    expect(s.every((p) => p.cycleLength === 3)).toBe(true);
  });

  it("cuatrimestral a 24 meses: 6 ciclos completos y 5 ajustes", () => {
    const s = buildSchedule({ ...base, adjustmentEveryMonths: 4 });
    expect(s.filter((p) => p.adjustsHere).map((p) => p.index)).toEqual([5, 9, 13, 17, 21]);
    expect(s[23]).toMatchObject({ cycle: 6, indexInCycle: 4, cycleLength: 4 });
  });

  it("último ciclo truncado: 18 meses cuatrimestral termina con un ciclo de 2 períodos (Período 1/4 y 2/4)", () => {
    const s = buildSchedule({ ...base, durationMonths: 18, adjustmentEveryMonths: 4 });
    expect(s).toHaveLength(18);
    expect(s.filter((p) => p.adjustsHere).map((p) => p.index)).toEqual([5, 9, 13, 17]);
    expect(s.slice(16).map((p) => [p.index, p.cycle, p.indexInCycle, p.cycleLength])).toEqual([
      [17, 5, 1, 4],
      [18, 5, 2, 4],
    ]);
    const s5 = buildSchedule({ ...base, adjustmentEveryMonths: 5 });
    expect(s5.slice(20).map((p) => `${p.cycle}:${p.indexInCycle}/${p.cycleLength}`)).toEqual([
      "5:1/5",
      "5:2/5",
      "5:3/5",
      "5:4/5",
    ]);
  });

  it("sin ajuste (null, 0, negativo o NaN): un solo ciclo, 'Período 7' sin denominador, nunca ajusta", () => {
    for (const adjustmentEveryMonths of [null, 0, -3, Number.NaN]) {
      const s = buildSchedule({ ...base, adjustmentEveryMonths });
      expect(s.every((p) => p.cycle === 1 && p.cycleLength === null && !p.adjustsHere)).toBe(true);
      expect(s.map((p) => p.indexInCycle)).toEqual(s.map((p) => p.index));
    }
  });

  it("una frecuencia fraccionaria se trunca (2,7 → bimestral)", () => {
    const s = buildSchedule({ ...base, adjustmentEveryMonths: 2.7, durationMonths: 6 });
    expect(s.filter((p) => p.adjustsHere).map((p) => p.index)).toEqual([3, 5]);
    expect(s[0].cycleLength).toBe(2);
  });

  it("ajuste mensual: ajusta todos los períodos menos el primero", () => {
    const s = buildSchedule({ ...base, adjustmentEveryMonths: 1, durationMonths: 4 });
    expect(s.map((p) => p.adjustsHere)).toEqual([false, true, true, true]);
    expect(s.map((p) => p.cycle)).toEqual([1, 2, 3, 4]);
  });
});

describe("periodAt", () => {
  const s = buildSchedule({ ...base, startDate: "2026-03-15" });

  it("encuentra el período que contiene la fecha, con inicio y fin inclusivos", () => {
    expect(periodAt(s, "2026-03-15")?.index).toBe(1);
    expect(periodAt(s, "2026-04-14")?.index).toBe(1);
    expect(periodAt(s, "2026-04-15")?.index).toBe(2);
    expect(periodAt(s, "2028-03-14")?.index).toBe(24);
  });

  it("devuelve null antes del inicio o después del fin del contrato", () => {
    expect(periodAt(s, "2026-03-14")).toBeNull();
    expect(periodAt(s, "2028-03-15")).toBeNull();
    expect(periodAt([], "2026-03-20")).toBeNull();
  });
});

describe("adjustmentCount", () => {
  it("cuenta los ajustes de contratos típicos", () => {
    expect(adjustmentCount(24, 3)).toBe(7);
    expect(adjustmentCount(24, 4)).toBe(5);
    expect(adjustmentCount(24, 6)).toBe(3);
    expect(adjustmentCount(36, 12)).toBe(2);
    expect(adjustmentCount(24, 12)).toBe(1);
    expect(adjustmentCount(18, 4)).toBe(4);
  });

  it("es 0 si el ajuste no llega a regir o no hay ajuste", () => {
    expect(adjustmentCount(24, 24)).toBe(0);
    expect(adjustmentCount(12, 12)).toBe(0);
    expect(adjustmentCount(24, null)).toBe(0);
    expect(adjustmentCount(24, 0)).toBe(0);
    expect(adjustmentCount(1, 1)).toBe(0);
    expect(adjustmentCount(0, 3)).toBe(0);
    expect(adjustmentCount(2, 1)).toBe(1);
  });

  it("coincide siempre con los períodos marcados adjustsHere del cronograma", () => {
    for (const durationMonths of [1, 2, 6, 12, 13, 18, 24, 25, 36]) {
      for (const every of [1, 2, 3, 4, 5, 6, 12, 24]) {
        const s = buildSchedule({ ...base, durationMonths, adjustmentEveryMonths: every });
        expect(adjustmentCount(durationMonths, every)).toBe(s.filter((p) => p.adjustsHere).length);
      }
    }
  });
});

describe("buildAdjustmentWindows", () => {
  const sched = (startDate: string, every: number | null, durationMonths = 24) =>
    buildSchedule({ startDate, durationMonths, adjustmentEveryMonths: every, paymentWindowDays: 10 });

  it("IPC cuatrimestral desde 01/01/2026, rezago 2: el 1er ajuste rige el 01/05/2026 y compara nov-2025 → mar-2026", () => {
    const w = buildAdjustmentWindows(sched("2026-01-01", 4), "2026-01-01", { frequency: "monthly", lagMonths: 2 });
    expect(w).toHaveLength(5);
    expect(w[0]).toEqual({
      sequence: 1,
      periodIndex: 5,
      effectiveDate: "2026-05-01",
      fromMonth: "2025-11-01",
      toMonth: "2026-03-01",
      fromDate: null,
      toDate: null,
    });
    // Se encadenan: la llegada de un ajuste es la salida del siguiente.
    expect(w[1]).toMatchObject({ periodIndex: 9, effectiveDate: "2026-09-01", fromMonth: "2026-03-01", toMonth: "2026-07-01" });
    expect(w[4]).toMatchObject({ sequence: 5, periodIndex: 21, effectiveDate: "2027-09-01", fromMonth: "2027-03-01", toMonth: "2027-07-01" });
    for (let i = 1; i < w.length; i++) expect(w[i].fromMonth).toBe(w[i - 1].toMonth);
  });

  it("IPC cuatrimestral desde 01/04/2026, rezago 2: el ajuste del 01/08/2026 compara feb-2026 → jun-2026", () => {
    const w = buildAdjustmentWindows(sched("2026-04-01", 4), "2026-04-01", { frequency: "monthly", lagMonths: 2 });
    expect(w[0]).toMatchObject({ effectiveDate: "2026-08-01", fromMonth: "2026-02-01", toMonth: "2026-06-01" });
  });

  it("rezago 1 = los meses del ciclo que termina (ajuste de junio → marzo, abril y mayo)", () => {
    const w = buildAdjustmentWindows(sched("2026-03-01", 3), "2026-03-01", { frequency: "monthly", lagMonths: 1 });
    // La variación incluye fromMonth+1 … toMonth: marzo, abril y mayo.
    expect(w[0]).toMatchObject({ effectiveDate: "2026-06-01", fromMonth: "2026-02-01", toMonth: "2026-05-01" });
  });

  it("rezago 2 = el último dato publicado al momento del ajuste (ajuste de junio → febrero, marzo y abril)", () => {
    const w = buildAdjustmentWindows(sched("2026-03-01", 3), "2026-03-01", { frequency: "monthly", lagMonths: 2 });
    expect(w[0]).toMatchObject({ effectiveDate: "2026-06-01", fromMonth: "2026-01-01", toMonth: "2026-04-01" });
  });

  it("rezago 0, negativo o fraccionario se normaliza (0 → mes del ajuste; −1 → 0; 1,7 → 1)", () => {
    const s = sched("2026-03-01", 3);
    const w0 = buildAdjustmentWindows(s, "2026-03-01", { frequency: "monthly", lagMonths: 0 });
    expect(w0[0]).toMatchObject({ fromMonth: "2026-03-01", toMonth: "2026-06-01" });
    const wNeg = buildAdjustmentWindows(s, "2026-03-01", { frequency: "monthly", lagMonths: -1 });
    expect(wNeg[0]).toMatchObject({ fromMonth: "2026-03-01", toMonth: "2026-06-01" });
    const wFrac = buildAdjustmentWindows(s, "2026-03-01", { frequency: "monthly", lagMonths: 1.7 });
    expect(wFrac[0]).toMatchObject({ fromMonth: "2026-02-01", toMonth: "2026-05-01" });
  });

  it("un contrato que arranca a mitad de mes usa el mes calendario de cada fecha", () => {
    const w = buildAdjustmentWindows(sched("2026-03-15", 3), "2026-03-15", { frequency: "monthly", lagMonths: 1 });
    expect(w[0]).toMatchObject({ effectiveDate: "2026-06-15", fromMonth: "2026-02-01", toMonth: "2026-05-01" });
  });

  it("ICL (diario) cuatrimestral desde 01/01/2026: compara el valor del 01/01 contra el del 01/05", () => {
    const w = buildAdjustmentWindows(sched("2026-01-01", 4), "2026-01-01", { frequency: "daily", lagMonths: 2 });
    expect(w[0]).toEqual({
      sequence: 1,
      periodIndex: 5,
      effectiveDate: "2026-05-01",
      fromMonth: null,
      toMonth: null,
      fromDate: "2026-01-01",
      toDate: "2026-05-01",
    });
    expect(w[1]).toMatchObject({ fromDate: "2026-05-01", toDate: "2026-09-01" });
  });

  it("índice diario con contrato del 31/01: las fechas siguen el pegado a fin de mes", () => {
    const w = buildAdjustmentWindows(sched("2026-01-31", 1, 4), "2026-01-31", { frequency: "daily", lagMonths: 0 });
    expect(w.map((x) => [x.fromDate, x.toDate])).toEqual([
      ["2026-01-31", "2026-02-28"],
      ["2026-02-28", "2026-03-31"],
      ["2026-03-31", "2026-04-30"],
    ]);
  });

  it("sin índice (porcentaje fijo, escalonado, manual): ventanas sin fechas pero con secuencia y vigencia", () => {
    const w = buildAdjustmentWindows(sched("2026-03-01", 6), "2026-03-01", { frequency: null, lagMonths: 2 });
    expect(w).toEqual([
      { sequence: 1, periodIndex: 7, effectiveDate: "2026-09-01", fromMonth: null, toMonth: null, fromDate: null, toDate: null },
      { sequence: 2, periodIndex: 13, effectiveDate: "2027-03-01", fromMonth: null, toMonth: null, fromDate: null, toDate: null },
      { sequence: 3, periodIndex: 19, effectiveDate: "2027-09-01", fromMonth: null, toMonth: null, fromDate: null, toDate: null },
    ]);
  });

  it("un contrato sin ajuste no tiene ventanas", () => {
    expect(buildAdjustmentWindows(sched("2026-03-01", null), "2026-03-01", { frequency: "monthly", lagMonths: 1 })).toEqual([]);
  });
});
