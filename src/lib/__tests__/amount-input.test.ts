import { describe, expect, it } from "vitest";
import {
  formatMoneyEditable,
  formatMoneyValue,
  parseMoneyInput,
} from "@/components/bookings/money-input";
import { parseAmountInput, parsePercentInput, splitTypedAmount } from "@/lib/format";
import { parsePriceInput } from "@/lib/units/pricing";

/**
 * Un importe mal leído no avisa: "1.500" leído como 1,5 guardaba un gasto de
 * Caja de $1.500 como $1,50, y "45.000" en el form de reserva era una noche a
 * $45. Estos casos fijan las reglas del parser permisivo (inputs sin aviso en
 * línea): miles bien agrupados ganan, un separador único es decimal con
 * cualquier cantidad de cifras (los strings de máquina de String(n) tienen que
 * seguir entrando) y lo que no encaja en ninguna forma es null — el caller
 * muestra un error en vez de guardar basura.
 */
describe("parseAmountInput", () => {
  it.each([
    // Enteros.
    ["0", 0],
    ["20", 20],
    ["1500", 1_500],
    ["1100000", 1_100_000],
    ["0045", 45],
    // Miles es-AR: el caso del bug.
    ["45.000", 45_000],
    ["1.500", 1_500],
    ["12.345", 12_345],
    ["1.100.000", 1_100_000],
    ["1.100.000,50", 1_100_000.5],
    ["1.100.000,5", 1_100_000.5],
    ["12.345,6789", 12_345.6789],
    // Miles en-US (copiado de algo en inglés).
    ["1,500", 1_500],
    ["1,100,000", 1_100_000],
    ["1,200.50", 1_200.5],
    ["1,100,000.50", 1_100_000.5],
    // Un solo separador → decimal, con cualquier cantidad de cifras.
    ["45.5", 45.5],
    ["45,5", 45.5],
    ["1500,50", 1_500.5],
    ["1500.50", 1_500.5],
    ["1100000,50", 1_100_000.5],
    ["1100.125", 1_100.125],
    ["1100.000", 1_100],
    ["1500,000", 1_500],
    ["1.100000", 1.1],
    ["0.125", 0.125],
    ["0.500", 0.5],
    ["0,004", 0.004],
    ["000.500", 0.5],
    ["0,5", 0.5],
    [",5", 0.5],
    [".5", 0.5],
    ["1,5", 1.5],
    ["1,50", 1.5],
    // Porcentajes.
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["27,50", 27.5],
    ["100", 100],
    // Separador colgando mientras se tipea.
    ["45.", 45],
    ["45,", 45],
    ["1.100.", 1_100],
    ["78.000,", 78_000],
    ["1,200.", 1_200],
    ["1100000,", 1_100_000],
    // Espacios en cualquier lado (también como separador de miles).
    [" 1.100.000 ", 1_100_000],
    ["1 100 000", 1_100_000],
    ["\t45,5\n", 45.5],
    // Negativos: mismo signo de siempre, ahora con los miles bien leídos.
    ["-1500", -1_500],
    ["-1.500", -1_500],
    ["-1500,50", -1_500.5],
    ["-45,5", -45.5],
    ["-,5", -0.5],
    ["- 1.500", -1_500],
    ["-45.", -45],
  ])("%j → %d", (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  it("-0 es 0 (Object.is distingue -0)", () => {
    expect(parseAmountInput("-0")).toBe(0);
    expect(parseAmountInput("-0,00")).toBe(0);
  });

  it.each([
    "", "   ", ".", ",", "..", ",,", "-", "-.", "-,",
    // Separadores que no son un agrupado válido: antes daban 110000050 o 123.
    "1.100.000.50", "1,2,3", "1.2.3", "1.10.000", "1,10,000", "1100,000.50",
    "1.5,2", "12.34,5", "1,500,00",
    // Colgando detrás de decimales: no hay nada que seguir tipeando.
    "45,5.", "1.100.000,50.",
    "45.,", "5..",
    // Basura.
    "abc", "12abc", "$1.500", "1e5", "0x10", "Infinity", "NaN", "+5", "--5", "5-",
  ])("%j → null", (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });

  it("null / undefined → null", () => {
    expect(parseAmountInput(null)).toBeNull();
    expect(parseAmountInput(undefined)).toBeNull();
  });

  /**
   * Los inputs se pre-llenan con String(n), toFixed(2) o el numeric que
   * devuelve PostgREST. Nada de eso lleva separador de miles, así que tiene
   * que volver a leerse igual — incluido el residuo de una resta de floats.
   */
  it.each([
    [String(1_499.8999999999999), 1_499.8999999999999],
    ["1499.8999999999999", 1_499.8999999999999],
    [String(0.1 + 0.2), 0.1 + 0.2],
    [String(1_100_000.5), 1_100_000.5],
    [(1_500).toFixed(2), 1_500],
    [(150).toFixed(2), 150],
    [(1_234.5).toFixed(2), 1_234.5],
    ["950000.00", 950_000],
    ["15.50", 15.5],
    ["0.00", 0],
    [String(33_333.33), 33_333.33],
  ])("string de máquina %j → %d", (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });
});

describe("splitTypedAmount", () => {
  it("separa signo, enteros y decimales", () => {
    expect(splitTypedAmount("-1.100.000,50")).toEqual({ negative: true, int: "1100000", frac: "50" });
    expect(splitTypedAmount("1,200.5")).toEqual({ negative: false, int: "1200", frac: "5" });
    expect(splitTypedAmount(",5")).toEqual({ negative: false, int: "", frac: "5" });
    expect(splitTypedAmount("1.100.")).toEqual({ negative: false, int: "1100", frac: null });
    expect(splitTypedAmount("1,2,3")).toBeNull();
  });
});

/** El form de reserva usa las mismas reglas: no pueden volver a divergir. */
describe("parseMoneyInput", () => {
  it.each([
    "45.000", "1.500", "1.100.000,50", "1,200.50", "45,5", "45.5", "1100.125",
    "1499.8999999999999", "12,5", "20", "", "1.100.000.50", "1,2,3", "-1.500", "45.",
  ])("%j se lee igual que en parseAmountInput", (input) => {
    expect(parseMoneyInput(input)).toBe(parseAmountInput(input));
  });

  it("los casos del bug", () => {
    expect(parseMoneyInput("45.000")).toBe(45_000);
    expect(parseMoneyInput("1.500")).toBe(1_500);
    expect(parseMoneyInput("1.100.000")).toBe(1_100_000);
  });
});

/**
 * El permisivo y el estricto comparten las reglas de separadores: donde el
 * estricto entiende algo, el permisivo entiende lo mismo.
 */
describe("parsePriceInput ⊂ parseAmountInput", () => {
  it.each([
    "1100000", "45.000", "1.100.000", "1,100,000", "1,100", "1.100.000,50",
    "1,100,000.50", "45,5", "45.5", "1100000,50", "0,5", ",5", "1100000,",
    "1.100.", "78.000,", "1,200.", " 1.100.000 ",
  ])("%j", (input) => {
    const strict = parsePriceInput(input);
    expect(strict).not.toBeNull();
    expect(parseAmountInput(input)).toBe(strict);
  });

  it("lo que el estricto rechaza por dudoso el permisivo lo lee como decimal", () => {
    expect(parsePriceInput("1100.000")).toBeNull();
    expect(parseAmountInput("1100.000")).toBe(1_100);
    expect(parsePriceInput("-5")).toBeNull();
    expect(parseAmountInput("-5")).toBe(-5);
  });
});

/**
 * El pre-llenado del form de reserva sale de formatMoneyValue /
 * formatMoneyEditable. Con ≤ 2 decimales un String(n) nunca tiene la forma
 * "123.456" (que el parser lee como miles), así que lo que se muestra se
 * vuelve a leer igual.
 */
describe("formatMoneyValue / formatMoneyEditable", () => {
  it.each([
    [1_500, "1500"],
    [1_500.5, "1500.5"],
    ["950000.00", "950000"],
    ["15.50", "15.5"],
    [0, "0"],
    [-1_500.5, "-1500.5"],
    // Un % con tres decimales en el JSON de la org: se lee 12125 sin redondear.
    [12.125, "12.13"],
    [308.625, "308.63"],
    // Residuo de una resta de floats.
    [1_499.8999999999999, "1499.9"],
    [0.1 + 0.2, "0.3"],
    [5.55e-17, "0"],
    [1e-7, "0"],
  ])("formatMoneyValue(%j) → %j", (input, expected) => {
    expect(formatMoneyValue(input)).toBe(expected);
  });

  it("vacío / inválido → ''", () => {
    expect(formatMoneyValue(null)).toBe("");
    expect(formatMoneyValue(undefined)).toBe("");
    expect(formatMoneyValue("")).toBe("");
    expect(formatMoneyValue("abc")).toBe("");
  });

  it("editable: 0 (o lo que redondea a 0) es 'no cargado'", () => {
    expect(formatMoneyEditable(0)).toBe("");
    expect(formatMoneyEditable("0.00")).toBe("");
    expect(formatMoneyEditable(0.001)).toBe("");
    expect(formatMoneyEditable(1_500)).toBe("1500");
    expect(formatMoneyEditable(12.125)).toBe("12.13");
  });

  it("lo que se muestra se vuelve a leer igual", () => {
    for (const n of [
      0.01, 0.5, 1, 12.5, 99.99, 100, 123.45, 308.63, 999.99, 1_000, 1_500.5,
      45_000, 1_100_000, 1_100_000.5, 12_345_678.9, -1_500.5,
    ]) {
      expect(parseMoneyInput(formatMoneyValue(n))).toBe(n);
      expect(parseAmountInput(n.toFixed(2))).toBe(n);
    }
  });
});

describe("parsePercentInput", () => {
  it.each([
    ["20", 20],
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["3,125", 3.125],
    ["2.125", 2.125],
    ["15.125", 15.125],
    ["0,5", 0.5],
    [",5", 0.5],
    ["-2,5", -2.5],
    [" 20 ", 20],
    ["100", 100],
  ])("%s → %d", (input, expected) => {
    expect(parsePercentInput(input)).toBe(expected);
  });

  it.each(["", "abc", ".", "1,2,3", "15..5"])("%j → null", (input) => {
    expect(parsePercentInput(input)).toBeNull();
  });
});
