import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  addMonthsToMonth,
  compareYmd,
  contractMonthsElapsed,
  daysInMonth,
  diffDays,
  isYmd,
  maxYmd,
  minYmd,
  monthOf,
  monthsBetween,
  parseYmd,
  toYmd,
} from "@/lib/rentals/ymd";

describe("isYmd", () => {
  it("acepta fechas de calendario reales, incluido el 29/02 de un año bisiesto", () => {
    expect(isYmd("2026-02-28")).toBe(true);
    expect(isYmd("2028-02-29")).toBe(true);
    expect(isYmd("2026-12-31")).toBe(true);
  });

  it("rechaza días que no existen: un vencimiento mal tipeado no puede pasar como válido", () => {
    expect(isYmd("2026-02-29")).toBe(false); // 2026 no es bisiesto
    expect(isYmd("2026-04-31")).toBe(false);
    expect(isYmd("2026-13-01")).toBe(false);
    expect(isYmd("2026-00-10")).toBe(false);
    expect(isYmd("2026-01-00")).toBe(false);
  });

  it("rechaza formatos que no son YYYY-MM-DD y valores que no son string", () => {
    expect(isYmd("2026-1-01")).toBe(false);
    expect(isYmd("01/03/2026")).toBe(false);
    expect(isYmd("2026-01-01T00:00:00Z")).toBe(false);
    expect(isYmd(20260101)).toBe(false);
    expect(isYmd(null)).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });
});

describe("parseYmd / toYmd", () => {
  it("son inversas y rellenan con ceros", () => {
    expect(parseYmd("2026-03-05")).toEqual([2026, 3, 5]);
    expect(toYmd(2026, 3, 5)).toBe("2026-03-05");
    expect(toYmd(...parseYmd("2027-11-30"))).toBe("2027-11-30");
  });
});

describe("daysInMonth", () => {
  it("conoce febrero bisiesto (incluida la regla de los siglos)", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29); // divisible por 400
    expect(daysInMonth(2100, 2)).toBe(28); // siglo no divisible por 400
  });

  it("devuelve 30/31 en el resto de los meses", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("diffDays / addDays", () => {
  it("cuenta días de calendario con signo", () => {
    expect(diffDays("2026-10-10", "2026-10-15")).toBe(5);
    expect(diffDays("2026-10-15", "2026-10-10")).toBe(-5);
    expect(diffDays("2026-10-10", "2026-10-10")).toBe(0);
    expect(diffDays("2025-12-31", "2026-01-01")).toBe(1);
    expect(diffDays("2028-02-28", "2028-03-01")).toBe(2); // pasa por el 29/02
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(diffDays("2028-01-01", "2029-01-01")).toBe(366);
  });

  it("no se corre un día por la zona horaria ni por cambios de hora (todo en UTC)", () => {
    // Cambio de hora de otros países (fines de marzo / octubre): sigue siendo 1 día.
    expect(diffDays("2026-03-28", "2026-03-29")).toBe(1);
    expect(diffDays("2026-10-24", "2026-10-25")).toBe(1);
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
  });

  it("suma y resta días cruzando meses y años", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-10-10", 0)).toBe("2026-10-10");
  });

  it("addDays y diffDays son consistentes", () => {
    const from = "2026-01-31";
    for (const n of [-400, -31, -1, 0, 1, 29, 365, 731]) {
      expect(diffDays(from, addDays(from, n))).toBe(n);
    }
  });
});

describe("addMonthsClamped", () => {
  it("pega al último día cuando el día no existe en el mes de destino", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("calculado desde el inicio original, un contrato del 31/01 vuelve al 31 (no queda pegado en el 28)", () => {
    // Encadenar sumas de a un mes perdería el 31 para siempre.
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped(addMonthsClamped("2026-01-31", 1), 1)).toBe("2026-03-28");
  });

  it("respeta los años bisiestos", () => {
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2028-02-29", 48)).toBe("2032-02-29");
  });

  it("cruza años hacia adelante y hacia atrás", () => {
    expect(addMonthsClamped("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonthsClamped("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonthsClamped("2026-03-01", 24)).toBe("2028-03-01");
    expect(addMonthsClamped("2026-03-01", 0)).toBe("2026-03-01");
  });
});

describe("compareYmd / minYmd / maxYmd", () => {
  it("ordenan cronológicamente (el orden lexicográfico de YYYY-MM-DD es el cronológico)", () => {
    expect(compareYmd("2026-01-31", "2026-02-01")).toBe(-1);
    expect(compareYmd("2026-02-01", "2026-01-31")).toBe(1);
    expect(compareYmd("2026-02-01", "2026-02-01")).toBe(0);
    expect(minYmd("2026-10-10", "2026-09-30")).toBe("2026-09-30");
    expect(maxYmd("2026-10-10", "2026-09-30")).toBe("2026-10-10");
    expect(["2026-03-01", "2025-12-31", "2026-01-15"].sort(compareYmd)).toEqual([
      "2025-12-31",
      "2026-01-15",
      "2026-03-01",
    ]);
  });
});

describe("claves de mes de índices mensuales", () => {
  it("monthOf lleva cualquier día al YYYY-MM-01 con el que se guarda el IPC", () => {
    expect(monthOf("2026-10-02")).toBe("2026-10-01");
    expect(monthOf("2026-10-31")).toBe("2026-10-01");
    expect(monthOf("2026-10-01")).toBe("2026-10-01");
  });

  it("addMonthsToMonth corre la clave de mes (y normaliza a día 1)", () => {
    expect(addMonthsToMonth("2026-01-01", -2)).toBe("2025-11-01");
    expect(addMonthsToMonth("2026-05-01", -2)).toBe("2026-03-01");
    expect(addMonthsToMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonthsToMonth("2025-12-01", 1)).toBe("2026-01-01");
  });

  it("monthsBetween cuenta meses enteros con signo", () => {
    expect(monthsBetween("2025-11-01", "2026-03-01")).toBe(4);
    expect(monthsBetween("2026-03-01", "2025-11-01")).toBe(-4);
    expect(monthsBetween("2026-03-01", "2026-03-01")).toBe(0);
    expect(monthsBetween("2026-01-31", "2026-02-01")).toBe(1); // sólo mira año y mes
  });
});

describe("contractMonthsElapsed", () => {
  it("vale 0 durante el primer mes y -1 antes del inicio", () => {
    expect(contractMonthsElapsed("2026-03-15", "2026-03-15")).toBe(0);
    expect(contractMonthsElapsed("2026-03-15", "2026-04-14")).toBe(0);
    expect(contractMonthsElapsed("2026-03-15", "2026-03-14")).toBe(-1);
  });

  it("cumple el mes el mismo día del mes siguiente", () => {
    expect(contractMonthsElapsed("2026-03-15", "2026-04-15")).toBe(1);
    expect(contractMonthsElapsed("2026-03-01", "2026-03-31")).toBe(0);
    expect(contractMonthsElapsed("2026-03-01", "2026-04-01")).toBe(1);
  });

  it("respeta el pegado a fin de mes: el 28/02 ya cumplió un mes de un contrato del 31/01", () => {
    expect(contractMonthsElapsed("2026-01-31", "2026-02-27")).toBe(0);
    expect(contractMonthsElapsed("2026-01-31", "2026-02-28")).toBe(1);
    expect(contractMonthsElapsed("2026-01-31", "2026-03-30")).toBe(1);
    expect(contractMonthsElapsed("2026-01-31", "2026-03-31")).toBe(2);
    expect(contractMonthsElapsed("2028-01-31", "2028-02-28")).toBe(0); // 2028: el mes se cumple el 29
    expect(contractMonthsElapsed("2028-01-31", "2028-02-29")).toBe(1);
  });

  it("cuenta bien contratos largos (24 meses) en el borde del último período", () => {
    expect(contractMonthsElapsed("2026-03-15", "2028-03-14")).toBe(23);
    expect(contractMonthsElapsed("2026-03-15", "2028-03-15")).toBe(24);
  });
});
