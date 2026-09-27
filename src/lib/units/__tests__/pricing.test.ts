import { describe, expect, it } from "vitest";
import {
  compareMonthlyToNightly,
  formatPriceInput,
  parsePriceInput,
  unitMonthlyPrice,
  unitPriceKinds,
} from "@/lib/units/pricing";

/**
 * Un precio mal leído no avisa: "45.000" leído como 45 guarda una noche a $45.
 * Estos casos fijan que los miles se lean como miles en los dos formatos y que
 * lo ambiguo quede en null (la pantalla lo marca) en vez de adivinarse.
 */
describe("parsePriceInput", () => {
  it.each([
    ["1100000", 1_100_000],
    ["45.000", 45_000],
    ["1.100.000", 1_100_000],
    ["1,100,000", 1_100_000],
    ["1,100", 1_100],
    ["1.100.000,50", 1_100_000.5],
    ["1,100,000.50", 1_100_000.5],
    ["45,5", 45.5],
    ["45.5", 45.5],
    ["1100000,50", 1_100_000.5],
    ["0,5", 0.5],
    [",5", 0.5],
    ["1100000,", 1_100_000],
    // Estados intermedios de tipeo sobre miles agrupados.
    ["1.100.", 1_100],
    ["78.000,", 78_000],
    ["1,200.", 1_200],
    [" 1.100.000 ", 1_100_000],
  ])("%s → %d", (input, expected) => {
    expect(parsePriceInput(input)).toBe(expected);
  });

  it.each([
    "", "   ", ".", ",", "..", "1.100.000.50", "1,2,3", "1.10.000", "abc",
    // Tres o más cifras después de un único separador: ni centavos ni miles.
    "1100.000", "1500,000", "1.100000", "1234.567",
    // Un grupo de miles no empieza en 0.
    "0.500", "0,004", "000.500",
    // Miles bien agrupados pero con tres o más decimales: tampoco son centavos.
    "12.345,678", "1,200.505",
    // Ningún precio es negativo (el parser permisivo sí acepta el signo).
    "-5", "-1.100.000",
    // Colgando detrás de centavos: no hay nada que seguir tipeando.
    "45,5.", "1.100.000,50,",
  ])(
    "%j → null",
    (input) => {
      expect(parsePriceInput(input)).toBeNull();
    },
  );

  it("lo que muestra formatPriceInput se vuelve a leer igual", () => {
    for (const n of [45_000, 1_100_000, 1_100_000.5, 0.5, 78_000, 12_345_678.9]) {
      expect(parsePriceInput(formatPriceInput(n))).toBe(n);
    }
  });
});

/**
 * El precio mensual existe para las mensuales y las mixtas (migraciones 063 y
 * 066); una temporaria nunca lo muestra aunque la fila lo traiga.
 */
describe("unitMonthlyPrice", () => {
  it("mixta con precio cargado → el precio", () => {
    expect(unitMonthlyPrice({ default_mode: "mixto", monthly_price: 1_100_000 })).toBe(1_100_000);
  });

  it("acepta el numeric como string (así lo devuelve PostgREST)", () => {
    expect(unitMonthlyPrice({ default_mode: "mixto", monthly_price: "950000.00" })).toBe(950_000);
  });

  it("mixta sin precio → null", () => {
    expect(unitMonthlyPrice({ default_mode: "mixto", monthly_price: null })).toBeNull();
    expect(unitMonthlyPrice({ default_mode: "mixto" })).toBeNull();
  });

  it("un precio en cero o inválido no cuenta", () => {
    expect(unitMonthlyPrice({ default_mode: "mixto", monthly_price: 0 })).toBeNull();
    expect(unitMonthlyPrice({ default_mode: "mixto", monthly_price: "abc" })).toBeNull();
  });

  it("una mensual también tiene precio mensual (migración 066)", () => {
    expect(unitMonthlyPrice({ default_mode: "mensual", monthly_price: 900_000 })).toBe(900_000);
  });

  it("una temporaria nunca tiene precio mensual, aunque la fila lo traiga", () => {
    expect(unitMonthlyPrice({ default_mode: "temporario", monthly_price: 900_000 })).toBeNull();
    expect(unitMonthlyPrice(null)).toBeNull();
  });
});

describe("unitPriceKinds", () => {
  it("temporario → noche; mensual → mes; mixto → los dos", () => {
    expect(unitPriceKinds("temporario")).toEqual({ nightly: true, monthly: false });
    expect(unitPriceKinds("mensual")).toEqual({ nightly: false, monthly: true });
    expect(unitPriceKinds("mixto")).toEqual({ nightly: true, monthly: true });
  });
});

describe("compareMonthlyToNightly", () => {
  it("mes más barato que 30 noches → ahorro positivo", () => {
    const r = compareMonthlyToNightly(1_170_000, 78_000);
    expect(r).not.toBeNull();
    expect(r!.thirtyNights).toBe(2_340_000);
    expect(r!.perNight).toBe(39_000);
    expect(r!.savingsPct).toBeCloseTo(50, 6);
  });

  it("mes más caro que 30 noches → ahorro negativo", () => {
    expect(compareMonthlyToNightly(3_000_000, 50_000)!.savingsPct).toBeCloseTo(-100, 6);
  });

  it("sin alguno de los dos precios no hay comparación", () => {
    expect(compareMonthlyToNightly(null, 78_000)).toBeNull();
    expect(compareMonthlyToNightly(1_000_000, 0)).toBeNull();
    expect(compareMonthlyToNightly(undefined, undefined)).toBeNull();
  });
});
